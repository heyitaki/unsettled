import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  placeBuilding,
  setMe,
  setTile,
  upsertPort,
  vertexProduction,
} from '../../model/board'
import { edgeEndpointVertexIds, hexVertexIds, vertexIncidentEdgeIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { RESOURCES, type Board, type Resource, type VertexId } from '../../model/types'
import {
  analyzeBoard,
  rankCandidates,
  resolveStatus,
  simulateWindowDetailed,
  type PreWindowResult,
} from '../analyze'
import { inferDraftState } from '../draft'
import { expansionTerm, walkSites } from '../expansion'
import { blockedVertices, blockVertex, legalSettlementVertices, vertexAdjacency } from '../legality'
import {
  addToHoldings,
  computeBoardContext,
  emptyHoldings,
  marginalTotal,
  marginalWithoutExpansion,
  occupancyFromBoard,
  slotScaleOf,
  type Holdings,
} from '../valuation'
import { DEFAULT_WEIGHTS, neutralSlotScales } from '../weights'
import { PAIR_TIE } from '../analyze'

const resources: readonly Resource[] = RESOURCES
const tokens = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12] as const
// This coastal port vertex touches exactly one land hex (-2,0); its other two
// members are sea. So you can never double-down *on* the port — an on-port
// settlement gets at most one hex of the matched resource.
const PORT_EDGE = 'e:-3,0;-2,0' as const
const PORT_VERTEX = 'v:-3,0;-2,-1;-2,0' as const
// Mirror-image pair used only to check that symmetric spots score identically;
// the left one happens to be PORT_VERTEX, but that test strips all ports.
const MIRROR_LEFT = 'v:-3,0;-2,-1;-2,0' as const
const MIRROR_RIGHT = 'v:2,0;2,1;3,0' as const

function filledBoard(playerCount = 2, pattern = 0): Board {
  let board = createBoard('standard4')
  for (let index = 2; index <= playerCount; index += 1) {
    board = addPlayer(board, { id: `p${index}`, name: `P${index}`, color: '#333333' })
  }
  for (let index = 0; index < board.hexes.length; index += 1) {
    const resource = resources[(index * 3 + pattern * 7 + Math.floor(index / 3)) % resources.length]
    const token = tokens[(index * 7 + pattern * 3) % tokens.length]
    board = setTile(board, board.hexes[index].coord, resource, token)
  }
  return board
}

// Strong, balanced production across the map plus a low-value wood 2:1 port.
// A wood-port monopoly should lose here: a port supplements production, it
// never replaces a hex of it, and wood is a low-worth resource.
function balancedBoard(): Board {
  let board = addPlayer(createBoard('standard4'), { id: 'p2', name: 'P2', color: '#333333' })
  board = { ...board, ports: [] }
  const assignments = [
    [{ q: -2, r: 0 }, 'wood', 6], // the port hex
    [{ q: 1, r: -2 }, 'brick', 6],
    [{ q: 2, r: -2 }, 'sheep', 8],
    [{ q: -2, r: 2 }, 'wheat', 6],
    [{ q: -1, r: 2 }, 'ore', 8],
  ] as const
  for (const [coord, resource, token] of assignments) {
    board = setTile(board, coord, resource, token)
  }
  return upsertPort(board, PORT_EDGE, 'wood', 2)
}

// PORT_VERTEX sits on a strong wheat hex with a matched wheat 2:1 port. The
// port still earns credit end-to-end when real surplus production feeds it —
// the legitimate niche.
function matchedPortBoard(): Board {
  let board = addPlayer(createBoard('standard4'), { id: 'p2', name: 'P2', color: '#333333' })
  board = { ...board, ports: [] }
  const assignments = [
    [{ q: -2, r: 0 }, 'wheat', 6],
    [{ q: 1, r: -2 }, 'brick', 5],
    [{ q: 2, r: -2 }, 'sheep', 4],
    [{ q: -1, r: 2 }, 'ore', 5],
  ] as const
  for (const [coord, resource, token] of assignments) {
    board = setTile(board, coord, resource, token)
  }
  return upsertPort(board, PORT_EDGE, 'wheat', 2)
}

const recommendationPair = (
  recommendation: ReturnType<typeof analyzeBoard>['recommendations'][number],
): VertexId[] => [
  recommendation.firstPick,
  ...recommendation.plannedSecond.slice(0, 1),
]

function pairResources(board: Board, pair: readonly VertexId[]): Set<string> {
  return new Set(pair.flatMap((vertexId) => Object.keys(vertexProduction(board, vertexId))))
}

/**
 * The pair rule `opponentPick` prices a first settlement by, written out against the public
 * scorers: a candidate's own score plus the best legal partner's, the partner read without its
 * expansion component holding the candidate and with its expansion against the standing
 * occupancy; of two candidates that are each other's best partner only the one worth more alone
 * is a candidate, unless the grant makes one orientation of the pair worth more than the other,
 * in which case that orientation is. Ties fall to grid order, as the scan's insertion does.
 */
function pairAwarePick(
  ctx: ReturnType<typeof computeBoardContext>,
  board: Board,
  playerId: string,
  blocked: ReadonlySet<VertexId>,
  standing: readonly VertexId[],
): {
  pick: VertexId
  mate: VertexId | null
  greedy: VertexId
  ownScore: (vertexId: VertexId) => number
} {
  const slot = { seats: board.players.length, slot: board.players.findIndex((p) => p.id === playerId) }
  const scale = slotScaleOf(ctx.weights, slot)
  const pieces = occupancyFromBoard(board)
  const occupancy = { ...pieces, blocked: new Set([...pieces.blocked, ...standing]), seat: playerId }
  const adjacency = vertexAdjacency(board.layout)
  const legal = boardGrid(board.layout).vertexIds.filter((vertexId) => !blocked.has(vertexId))
  const own = legal.map((vertexId) => marginalTotal(
    ctx,
    emptyHoldings(),
    vertexId,
    null,
    occupancy,
    slot,
  ))
  const expansion = legal.map((vertexId) =>
    scale.expansion * expansionTerm(ctx, emptyHoldings(), occupancy, vertexId).value)
  const plans = legal.map((vertexId, index) => {
    const holdings = addToHoldings(ctx, emptyHoldings(), vertexId)
    let mate = -1
    let best = -Infinity
    for (const [other, otherId] of legal.entries()) {
      if (other === index || adjacency.get(vertexId)?.includes(otherId)) continue
      const partner = marginalWithoutExpansion(
        ctx, holdings, otherId, ctx.stats.get(otherId)?.setupGrant ?? null, slot,
      ) + expansion[other]
      if (partner > best) {
        best = partner
        mate = other
      }
    }
    return { index, mate, score: mate < 0 ? own[index] : own[index] + best }
  })
  const ranked = plans
    .filter(({ index, mate, score }) => {
      if (mate < 0 || plans[mate].mate !== index) return true
      const gap = score - plans[mate].score
      if (Math.abs(gap) > PAIR_TIE) return gap > 0
      return own[mate] < own[index] || (own[mate] === own[index] && index < mate)
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const greedy = legal[own.indexOf(Math.max(...own))]
  const top = ranked[0]
  return {
    pick: legal[top.index],
    mate: top.mate < 0 ? null : legal[top.mate],
    greedy,
    ownScore: (vertexId: VertexId) => own[legal.indexOf(vertexId)],
  }
}

function holdingsFor(board: Board, playerId: string) {
  const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
  let holdings = emptyHoldings()
  for (const building of board.buildings) {
    if (building.playerId === playerId) holdings = addToHoldings(ctx, holdings, building.vertexId)
  }
  return { ctx, holdings }
}

describe('joint draft analysis', () => {
  it('survival-aware ranking strictly beats the naive top-two plan', () => {
    let witness:
      | {
          analysis: ReturnType<typeof analyzeBoard>
          board: Board
          n1: VertexId
          n2: VertexId
          naiveFirst: number
          naiveSecond: number
          taken: VertexId[]
        }
      | undefined
    for (let pattern = 0; pattern < 80 && witness === undefined; pattern += 1) {
      const board = filledBoard(2, pattern)
      const { ctx, holdings } = holdingsFor(board, 'aki')
      const singles = legalSettlementVertices(board)
        .map((vertexId) => ({
          vertexId,
          score: marginalTotal(ctx, holdings, vertexId),
        }))
        .sort((a, b) => b.score - a.score)
      const [first, second] = singles
      const { taken } = simulateWindowDetailed(
        ctx,
        board,
        [
          { playerId: 'p2', receivesGrant: false, hasLaterPick: true },
          { playerId: 'p2', receivesGrant: true, hasLaterPick: false },
        ],
        new Map(),
        blockedVertices(board.layout, [first.vertexId]),
        new Set([first.vertexId]),
        () => 0,
      )
      const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
      const top = analysis.recommendations[0]
      const naiveEntry = analysis.recommendations.find((entry) => entry.firstPick === first.vertexId)
      if (top && naiveEntry &&
        top.firstPick !== first.vertexId &&
        top.rankScore > naiveEntry.rankScore + 0.5 &&
        taken.includes(second.vertexId) &&
        naiveEntry.score < first.score + second.score) {
        witness = {
          analysis,
          board,
          n1: first.vertexId,
          n2: second.vertexId,
          naiveFirst: first.score,
          naiveSecond: second.score,
          taken,
        }
      }
    }
    expect(witness).toBeDefined()
    const top = witness!.analysis.recommendations[0]
    const naiveEntry = witness!.analysis.recommendations.find((entry) => entry.firstPick === witness!.n1)!
    expect(top.firstPick).not.toBe(witness!.n1)
    expect(top.rankScore).toBeGreaterThan(naiveEntry.rankScore + 0.5)
    expect(witness!.taken).toContain(witness!.n2)
    expect(naiveEntry.score).toBeLessThan(witness!.naiveFirst + witness!.naiveSecond)
  })

  it('is deterministic and rollout one is a pure greedy line', () => {
    const board = filledBoard(3, 4)
    const first = analyzeBoard(board, { seed: 41 })
    expect(analyzeBoard(board, { seed: 41 })).toEqual(first)
    const greedy = analyzeBoard(board, { seed: 41, rollouts: 1 })
    expect(greedy.recommendations.every((entry) => entry.survival === 0 || entry.survival === 1)).toBe(true)
    expect(greedy.takenBeforeFirstPick.every((entry) => entry.frequency === 1)).toBe(true)
  })

  it('uses common random numbers for mirror-equivalent candidate valuations', () => {
    let board = addPlayer(createBoard('standard4'), {
      id: 'p2',
      name: 'P2',
      color: '#333333',
    })
    board = { ...board, ports: [] }
    for (const hex of board.hexes) board = setTile(board, hex.coord, 'wood', 6)
    expect(boardGrid(board.layout).vertexIds).toContain(MIRROR_LEFT)
    expect(boardGrid(board.layout).vertexIds).toContain(MIRROR_RIGHT)
    const analysis = analyzeBoard(board, { maxResults: 54 })
    const left = analysis.recommendations.find((entry) => entry.firstPick === MIRROR_LEFT)
    const right = analysis.recommendations.find((entry) => entry.firstPick === MIRROR_RIGHT)
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect(left!.survival).toBeCloseTo(right!.survival, 12)
    expect(left!.score).toBeCloseTo(right!.score, 12)
  })

  it('lets production+diversity win over a port monopoly, yet still credits a matched port', () => {
    // Diversity + production wins end-to-end: the top pick spans multiple
    // resources, leans on production rather than the port, and no wood-only
    // port monopoly is even competitive enough to surface.
    const balanced = balancedBoard()
    const balancedAnalysis = analyzeBoard(balanced, { rollouts: 1, maxResults: 54 })
    const balancedTop = balancedAnalysis.recommendations[0]
    const topResources = pairResources(balanced, recommendationPair(balancedTop))
    expect(topResources.size).toBeGreaterThanOrEqual(2)
    expect(topResources).not.toEqual(new Set(['wood']))
    expect(balancedTop.breakdown.production).toBeGreaterThan(balancedTop.breakdown.port)
    const woodMonopoly = balancedAnalysis.recommendations.filter((entry) => {
      const resources = pairResources(balanced, recommendationPair(entry))
      return resources.size === 1 && resources.has('wood')
    })
    for (const monopoly of woodMonopoly) {
      expect(balancedTop.rankScore).toBeGreaterThan(monopoly.rankScore)
    }

    // A matched 2:1 port still earns real credit when surplus production feeds
    // it: the on-port wheat spot surfaces with a positive port contribution.
    const matched = matchedPortBoard()
    const matchedAnalysis = analyzeBoard(matched, { rollouts: 1, maxResults: 54 })
    const portRecommendation = matchedAnalysis.recommendations.find(
      (entry) => entry.firstPick === PORT_VERTEX,
    )
    expect(portRecommendation).toBeDefined()
    expect(portRecommendation!.breakdown.port).toBeGreaterThan(0)
  })

  it('prefers strong production near a matching port over sitting on it', () => {
    // Three wheat hexes inland of a wheat 2:1 port. The port vertex touches
    // only one of them, so the strong spot is two road-builds away — the case
    // that is unrepresentable without near-port reach.
    let board = addPlayer(createBoard('standard4'), { id: 'p2', name: 'P2', color: '#333333' })
    board = { ...board, ports: [] }
    const assignments = [
      [{ q: -2, r: 0 }, 'wheat', 6],
      [{ q: -1, r: 0 }, 'wheat', 8],
      [{ q: -1, r: 1 }, 'wheat', 5],
      [{ q: 1, r: -2 }, 'brick', 4],
      [{ q: 2, r: -2 }, 'sheep', 10],
      [{ q: -1, r: 2 }, 'ore', 4],
    ] as const
    for (const [coord, resource, token] of assignments) {
      board = setTile(board, coord, resource, token)
    }
    board = upsertPort(board, PORT_EDGE, 'wheat', 2)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const score = (vertexId: VertexId): number =>
      marginalTotal(ctx, emptyHoldings(), vertexId)
    const reachFor = (vertexId: VertexId): number =>
      ctx.stats.get(vertexId)?.ports.find((access) => access.port.resource === 'wheat')?.reach ?? 0

    const inland: VertexId = 'v:-2,0;-1,-1;-1,0' // two roads out
    const onPort: VertexId = 'v:-3,0;-2,-1;-2,0' // on the port edge
    const oneRoad: VertexId = 'v:-2,-1;-2,0;-1,-1' // one road out
    // Pin the production these ids are assumed to carry, so a grid re-key
    // fails here rather than silently comparing different spots.
    expect(vertexProduction(board, inland)).toEqual({ wheat: 10 })
    expect(vertexProduction(board, onPort)).toEqual({ wheat: 5 })
    expect(vertexProduction(board, oneRoad)).toEqual({ wheat: 5 })
    expect(reachFor(onPort)).toBe(1)
    expect(reachFor(inland)).toBeGreaterThan(0)
    expect(reachFor(inland)).toBeLessThan(1)
    // Production wins: double the wheat beats holding the port outright.
    expect(score(inland)).toBeGreaterThan(score(onPort))
    // But reach still decays, so equal production prefers the closer access.
    expect(score(onPort)).toBeGreaterThan(score(oneRoad))
  })

  it('simulates opponents before a not-my-turn pick, each pricing its first settlement as a pair', () => {
    const board = setMe(filledBoard(5, 3), 'p4')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    expect(analysis.status).toBe('ready')
    const { ctx } = holdingsFor(board, 'aki')
    const { pick, greedy } = pairAwarePick(ctx, board, 'aki', new Set(), [])
    // aki picks first and again last, so its first settlement is worth the pair it leads to; on
    // this board that is not the vertex that scores best alone, which is what makes the case bite.
    expect(pick).not.toBe(greedy)
    expect(analysis.takenBeforeFirstPick[0]).toMatchObject({ vertexId: pick, playerId: 'aki' })
    expect(analysis.recommendations.every((entry) => entry.survival > 0)).toBe(true)
  })

  it('prices each first settlement in a window as a pair, taking the contested half first', () => {
    const board = filledBoard(4, 3)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const adjacency = vertexAdjacency(board.layout)
    const pickers = ['aki', 'p2', 'p3']
    const { taken } = simulateWindowDetailed(
      ctx,
      board,
      pickers.map((playerId) => ({ playerId, receivesGrant: false, hasLaterPick: true })),
      new Map(),
      new Set(),
      new Set(),
      () => 0,
    )
    expect(taken).toHaveLength(pickers.length)
    const blocked = new Set<VertexId>()
    const standing: VertexId[] = []
    for (const [turn, playerId] of pickers.entries()) {
      const { pick, mate, greedy } = pairAwarePick(ctx, board, playerId, blocked, standing)
      expect(taken[turn]).toBe(pick)
      // The half of the pair the modal pick leaves for later is the one worth less alone.
      expect(mate).not.toBeNull()
      if (turn === 0) expect(pick).not.toBe(greedy)
      blockVertex(adjacency, blocked, pick)
      standing.push(pick)
    }
  })

  it('takes the orientation of a pair the grant makes worth more, before the contested half', () => {
    // The second settlement receives the setup grant, so with the grant priced the pair is worth
    // more in one order than the other, and that order wins over the half worth more alone.
    const weights = { ...DEFAULT_WEIGHTS, handValueWeight: 0.4 }
    const board = setMe(filledBoard(2, 1), 'p2')
    const ctx = computeBoardContext(board, weights)
    const { pick, mate, ownScore } = pairAwarePick(ctx, board, 'aki', new Set(), [])
    expect(mate).not.toBeNull()
    expect(ownScore(pick)).toBeLessThan(ownScore(mate!))
    const analysis = analyzeBoard(board, { rollouts: 1, weights })
    expect(analysis.takenBeforeFirstPick[0]).toMatchObject({ vertexId: pick, playerId: 'aki' })
  })

  it('conditions a one-pick remainder on the existing settlement', () => {
    const base = filledBoard(2, 5)
    const { ctx } = holdingsFor(base, 'aki')
    const existing = legalSettlementVertices(base)
      .sort((a, b) =>
        marginalTotal(ctx, emptyHoldings(), b) -
        marginalTotal(ctx, emptyHoldings(), a))[0]
    const board = placeBuilding(base, existing, 'aki', 'settlement')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    expect(analysis.status).toBe('ready')
    expect(analysis.recommendations.every((entry) => entry.plannedSecond.length === 0)).toBe(true)
    const existingHoldings = addToHoldings(ctx, emptyHoldings(), existing)
    // Seats pick ahead of this last one, so the settlements standing when it is made are the
    // board's own beside the ones the rollout took, and that is what it has to be scored against.
    expect(analysis.takenBeforeFirstPick.length).toBeGreaterThan(0)
    const pieces = occupancyFromBoard(board)
    const standing = {
      ...pieces,
      blocked: new Set([
        ...pieces.blocked,
        ...analysis.takenBeforeFirstPick.map((entry) => entry.vertexId),
      ]),
      seat: 'aki',
    }
    expect(analysis.recommendations[0].score).toBeCloseTo(
      marginalTotal(
        ctx,
        existingHoldings,
        analysis.recommendations[0].firstPick,
        ctx.stats.get(analysis.recommendations[0].firstPick)?.setupGrant ?? null,
        standing,
      ),
    )
  })

  it('does not simulate a placed-early self slot as an opponent pick', () => {
    const base = setMe(filledBoard(2, 6), 'p2')
    const existing = legalSettlementVertices(base)[0]
    const board = placeBuilding(base, existing, 'p2', 'settlement')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    expect(analysis.warnings).toContain('snake-inconsistent')
    expect(analysis.draft.myRemainingPickIndices).toEqual([2])
    expect(analysis.takenBeforeFirstPick).toEqual([])
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const holdings = addToHoldings(ctx, emptyHoldings(), existing)
    expect(analysis.recommendations[0].score).toBeCloseTo(marginalTotal(
      ctx,
      holdings,
      analysis.recommendations[0].firstPick,
      ctx.stats.get(analysis.recommendations[0].firstPick)?.setupGrant ?? null,
    ))
  })

  it('reconciles a placed-early opponent before the pre-window', () => {
    const base = filledBoard(2, 6)
    const existing = legalSettlementVertices(base)[0]
    const board = placeBuilding(base, existing, 'p2', 'settlement')
    const analysis = analyzeBoard(board, { rollouts: 8, maxResults: 54 })

    expect(analysis.warnings).toContain('snake-inconsistent')
    expect(analysis.draft.remainingPickIndices
      .filter((index) => analysis.draft.sequence[index] === 'p2')).toEqual([2])
    // The reconciled early p2 placement leaves exactly one opponent pick before
    // my turn; the modal pre-window attributes that single spot to p2, with a
    // frequency in (0, 1] reflecting how often that exact spot leads the window.
    expect(analysis.takenBeforeFirstPick).toHaveLength(1)
    expect(analysis.takenBeforeFirstPick[0].playerId).toBe('p2')
    expect(analysis.takenBeforeFirstPick[0].frequency).toBeGreaterThan(0)
    expect(analysis.takenBeforeFirstPick[0].frequency).toBeLessThanOrEqual(1)
  })

  it('reconciles a placed-early opponent between my picks', () => {
    const base = setMe(filledBoard(3, 7), 'p2')
    const existing = legalSettlementVertices(base)[0]
    const board = placeBuilding(base, existing, 'p3', 'settlement')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })

    expect(analysis.warnings).toContain('snake-inconsistent')
    expect(analysis.draft.remainingPickIndices
      .filter((index) => analysis.draft.sequence[index] === 'p3')).toEqual([3])
    expect(analysis.recommendations.length).toBeGreaterThan(0)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const [firstPickIndex, secondPickIndex] = analysis.draft.myRemainingPickIndices
    const turns = analysis.draft.remainingPickIndices
      .filter((index) => index > firstPickIndex && index < secondPickIndex)
      .map((index) => ({
        playerId: analysis.draft.sequence[index],
        receivesGrant: true,
        hasLaterPick: false,
      }))
    for (const entry of analysis.recommendations) {
      const { taken } = simulateWindowDetailed(
        ctx,
        board,
        turns,
        new Map([['p3', addToHoldings(ctx, emptyHoldings(), existing)]]),
        blockedVertices(board.layout, [existing, entry.firstPick]),
        new Set([existing, entry.firstPick]),
        () => 0,
      )
      expect(taken).toHaveLength(1)
    }
  })

  it('reports the expansion walk road only while the walk is on', () => {
    const board = filledBoard(3, 4)
    const off = { ...DEFAULT_WEIGHTS, expansionWeight: 0 }
    const silent = analyzeBoard(board, { rollouts: 1, maxResults: 54, weights: off })
    expect(silent.recommendations.length).toBeGreaterThan(0)
    expect(silent.recommendations.every((entry) => entry.firstRoad === null)).toBe(true)

    // The shipped weight is 0.1 since the SP6 adoption, so the walk is on by default and the
    // recommendations carry roads without being told to.
    for (const weights of [DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, expansionWeight: 0.3 }]) {
      const witness = analyzeBoard(board, { rollouts: 1, maxResults: 54, weights })
      const withRoads = witness.recommendations.filter((entry) => entry.firstRoad !== null)
      expect(withRoads.length).toBeGreaterThan(0)
      const ctx = computeBoardContext(board, weights)
      // The reported road comes off the modal rollout, the same one `takenBeforeFirstPick` is
      // drawn from, so the drawn road and the drawn losses cannot contradict each other.
      const pieces = occupancyFromBoard(board)
      const occupancy = {
        ...pieces,
        blocked: new Set([
          ...pieces.blocked,
          ...witness.takenBeforeFirstPick.map((taken) => taken.vertexId),
        ]),
        seat: 'aki',
      }
      for (const entry of withRoads) {
        expect(vertexIncidentEdgeIds(entry.firstPick)).toContain(entry.firstRoad)
        expect(expansionTerm(ctx, holdingsFor(board, 'aki').holdings, occupancy, entry.firstPick).road)
          .toBe(entry.firstRoad)
      }
    }
  })

  // The rollout's `blocked` set is closed under the distance rule, so it carries the neighbours of
  // my own first pick beside the pick itself. Reading that set as the occupancy made those
  // neighbours look like rivals' settlements, and the walk in `expansion.ts` stops dead at a rival.
  it('prices the second pick against the settlements standing, not the vertices the rule bars', () => {
    const board = filledBoard(1)
    const weights = { ...DEFAULT_WEIGHTS, expansionWeight: 0.5 }
    const ctx = computeBoardContext(board, weights)
    const [top] = analyzeBoard(board, { rollouts: 1, maxResults: 54, weights }).recommendations
    const first = top.firstPick
    const second = top.plannedSecond[0]

    // The two readings disagree about exactly my own first pick's neighbours, and nobody has
    // settled any of them.
    const barred = [...blockedVertices(board.layout, [first])].filter((vertexId) => vertexId !== first)
    expect(new Set(barred)).toEqual(new Set(vertexAdjacency(board.layout).get(first)))
    expect(board.buildings).toEqual([])

    const pieces = occupancyFromBoard(board)
    const seated = (blocked: ReadonlySet<VertexId>) => ({ ...pieces, blocked, seat: 'aki' })
    const held = addToHoldings(ctx, emptyHoldings(), first)
    const own = new Set<VertexId>([...held.vertices, second])
    const settled = seated(new Set([first]))
    const closed = seated(blockedVertices(board.layout, [first]))
    // Sites the walk reaches only once my own settlement's neighbours stop reading as rivals.
    const reachedUnderClosed = new Set(walkSites(board.layout, closed, own, second)!.output.siteVertex)
    const opened = walkSites(board.layout, settled, own, second)!.output.siteVertex
      .filter((vertex) => !reachedUnderClosed.has(vertex))
    expect(opened.length).toBeGreaterThan(0)

    const firstTerm =
      expansionTerm(ctx, emptyHoldings(), occupancyFromBoard(board, 'aki'), first).value
    expect(expansionTerm(ctx, held, settled, second).value)
      .toBeGreaterThan(expansionTerm(ctx, held, closed, second).value)
    expect(top.breakdown.expansion)
      .toBeCloseTo(firstTerm + expansionTerm(ctx, held, settled, second).value, 10)
  })

  it('reads one occupancy on both picks when the rollout took nothing', () => {
    const board = filledBoard(1)
    const weights = { ...DEFAULT_WEIGHTS, expansionWeight: 0.5 }
    const ctx = computeBoardContext(board, weights)
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54, weights })
    const [top] = analysis.recommendations
    const first = top.firstPick
    const second = top.plannedSecond[0]
    // A solo roster drafts alone, so nothing is taken between my two picks.
    expect(analysis.draft.sequence).toEqual(['aki', 'aki'])

    // The same board with my first pick standing on it, where the one pick left is scored as a
    // first pick off `occupancyFromBoard`. The second pick has to read exactly that.
    const placed = analyzeBoard(placeBuilding(board, first, 'aki', 'settlement'), {
      rollouts: 1,
      maxResults: 54,
      weights,
    })
    const asFirstPick = placed.recommendations.find((entry) => entry.firstPick === second)
    expect(asFirstPick).toBeDefined()
    const firstTerm =
      expansionTerm(ctx, emptyHoldings(), occupancyFromBoard(board, 'aki'), first).value
    expect(firstTerm).toBeGreaterThan(0)
    expect(asFirstPick!.breakdown.expansion).toBeGreaterThan(0)
    expect(top.breakdown.expansion).toBeCloseTo(firstTerm + asFirstPick!.breakdown.expansion, 10)
  })

  // Both of these boards have more than one seat, which is where the two occupancy readings can
  // actually part: a solo roster takes nothing between the two picks, so every set is the same set.
  it('prices the first pick against the settlements the rollout took before it', () => {
    const board = filledBoard(2)
    const draft = inferDraftState(board)
    const weights = { ...DEFAULT_WEIGHTS, expansionWeight: 1 }
    const ctx = computeBoardContext(board, weights)
    expect(board.buildings).toEqual([])
    // Two vertices a road apart on the same hex ring: legal together, and the take sits inside the
    // candidate's expansion range, so the walk has to see it.
    const candidate = 'v:-1,-1;-1,0;0,-1' as VertexId
    const taken = 'v:-1,0;-1,1;0,0' as VertexId
    // Everything else barred, so the pick has no legal second and its score is the first alone.
    const blocked = new Set(boardGrid(board.layout).vertexIds)
    blocked.delete(candidate)

    const pieces = occupancyFromBoard(board)
    const seated = (occupied: ReadonlySet<VertexId>) => ({ ...pieces, blocked: occupied, seat: 'aki' })
    const under = (occupied: ReadonlySet<VertexId>) => marginalTotal(
      ctx,
      emptyHoldings(),
      candidate,
      null,
      seated(occupied),
    )
    expect(under(new Set([taken]))).toBeLessThan(under(new Set()))

    const result = rankCandidates(ctx, board, draft, [{
      blocked,
      taken: [taken],
      pickerIds: ['p2'],
      uniforms: draft.sequence.map(() => 0),
    }], 54)
    const entry = result.recommendations.find((recommendation) => recommendation.firstPick === candidate)
    expect(entry).toBeDefined()
    expect(entry!.plannedSecond).toEqual([])
    expect(entry!.score).toBeCloseTo(under(new Set([taken])))
  })

  // A rollout bars a vertex by the distance rule but occupies only the vertex itself, and the two
  // sets are what the scan hands the walk. Reading the barred set as the occupancy would make a
  // rival's neighbours look like rivals; forgetting to occupy a pick would let the next seat in the
  // window walk straight through it.
  it('scans each rollout pick against the settlements standing, not the vertices the rule bars', () => {
    const board = filledBoard(3)
    const weights = { ...DEFAULT_WEIGHTS, expansionWeight: 1 }
    const ctx = computeBoardContext(board, weights)
    expect(board.buildings).toEqual([])
    const pieces = occupancyFromBoard(board)
    const vertexIds = boardGrid(board.layout).vertexIds
    const argmax = (seat: string, blocked: ReadonlySet<VertexId>, occupied: ReadonlySet<VertexId>) => {
      let best: VertexId | null = null
      let bestScore = -Infinity
      for (const vertexId of vertexIds) {
        if (blocked.has(vertexId)) continue
        const total = marginalTotal(
          ctx,
          emptyHoldings(),
          vertexId,
          null,
          { ...pieces, blocked: occupied, seat },
        )
        if (total > bestScore) {
          best = vertexId
          bestScore = total
        }
      }
      return best
    }

    const barred = blockedVertices(board.layout, ['v:0,0;1,-1;1,0' as VertexId])
    const { taken } = simulateWindowDetailed(
      ctx,
      board,
      ['p2', 'p3'].map((playerId) => ({ playerId, receivesGrant: false, hasLaterPick: false })),
      new Map<string, Holdings>(),
      new Set(barred),
      new Set(),
      () => 0,
    )
    expect(taken).toHaveLength(2)

    // The first seat scans against an empty occupancy: nothing is settled yet, however much the
    // distance rule has barred.
    expect(taken[0]).toBe(argmax('p2', barred, new Set()))
    expect(argmax('p2', barred, barred)).not.toBe(taken[0])

    // The second seat scans against the first seat's settlement, and only that one vertex.
    const barredAfter = blockedVertices(board.layout, ['v:0,0;1,-1;1,0' as VertexId, taken[0]])
    expect(taken[1]).toBe(argmax('p3', barredAfter, new Set([taken[0]])))
    expect(argmax('p3', barredAfter, new Set())).not.toBe(taken[1])
  })

  it('scores each player at its own index in board.players as its draft slot', () => {
    // Only one slot's diversity is zeroed, so the seat that lands on it is the only one whose
    // recommendations come back with no diversity at all. That is the whole of the SP4 contract
    // on the app side: the slot a seat scores from is its position in `board.players`, which is
    // the order `draft.ts` builds the snake from.
    const board = filledBoard(3, 4)
    expect(board.players.map((player) => player.id)).toEqual(['aki', 'p2', 'p3'])
    const silenced = (slot: number) => {
      const slotScales = neutralSlotScales()
      slotScales['3'][String(slot)] = { expansion: 1, diversity: 0 }
      return { ...DEFAULT_WEIGHTS, slotScales }
    }

    const diversityOf = (playerId: string, slot: number): number[] =>
      analyzeBoard(setMe(board, playerId), {
        rollouts: 1,
        maxResults: 54,
        weights: silenced(slot),
      }).recommendations.map((entry) => entry.breakdown.diversity)

    for (const [index, playerId] of ['aki', 'p2', 'p3'].entries()) {
      const own = diversityOf(playerId, index)
      expect(own.length).toBeGreaterThan(0)
      expect(own.every((value) => value === 0)).toBe(true)
      // Silencing any other slot leaves this seat's diversity where it was.
      const other = diversityOf(playerId, (index + 1) % 3)
      expect(other.some((value) => value !== 0)).toBe(true)
    }
  })
})

describe('hostile states and simulator seams', () => {
  it('reports numberless, me-done, and complete hostile boards', () => {
    expect(analyzeBoard(addPlayer(createBoard('standard4'), {
      id: 'p2',
      name: 'P2',
      color: '#333333',
    })).status).toBe('no-production')

    const live = filledBoard(3)
    const vertices = boardGrid(live.layout).vertexIds
    const meDone = placeBuilding(
      placeBuilding(live, vertices[0], 'aki', 'settlement'),
      vertices[4],
      'aki',
      'settlement',
    )
    expect(analyzeBoard(meDone).status).toBe('me-done')

    let complete = filledBoard(2)
    while (legalSettlementVertices(complete).length > 0) {
      const next = legalSettlementVertices(complete)[0]
      complete = placeBuilding(
        complete,
        next,
        complete.buildings.length % 2 === 0 ? 'aki' : 'p2',
        'settlement',
      )
    }
    expect(complete.buildings.length).toBeGreaterThanOrEqual(complete.players.length * 2)
    expect(legalSettlementVertices(complete)).toEqual([])
    expect(analyzeBoard(complete).status).toBe('complete')
  })

  it('skips an opponent when no legal spot exists', () => {
    const board = filledBoard(2)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const blocked = new Set(boardGrid(board.layout).vertexIds)
    expect(simulateWindowDetailed(
      ctx,
      board,
      [{ playerId: 'p2', receivesGrant: false, hasLaterPick: false }],
      new Map<string, Holdings>(),
      blocked,
      new Set(),
      () => 0,
    ).taken).toEqual([])
  })

  it('ranks a zero-pip port that synergizes with an existing holding', () => {
    let board = setMe(addPlayer(createBoard('standard4'), {
      id: 'p2',
      name: 'P2',
      color: '#333333',
    }), 'p2')
    board = { ...board, ports: [] }
    board = setTile(board, { q: 0, r: 0 }, 'wood', 6)
    const centerVertices = hexVertexIds({ q: 0, r: 0 })
    board = placeBuilding(board, centerVertices[3], 'aki', 'settlement')
    board = placeBuilding(board, centerVertices[0], 'p2', 'settlement')
    const portEdge = boardGrid(board.layout).coastalEdgeIds[0]
    const portVertex = edgeEndpointVertexIds(portEdge)[0]
    board = upsertPort(board, portEdge, 'wood', 2)

    expect(legalSettlementVertices(board).every((vertexId) =>
      Object.values(vertexProduction(board, vertexId))
        .every((amount) => amount === undefined || amount === 0))).toBe(true)
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    const portRecommendation = analysis.recommendations
      .find((entry) => entry.firstPick === portVertex)
    expect(analysis.warnings).toEqual([])
    expect(analysis.status).toBe('ready')
    expect(portRecommendation?.score).toBeGreaterThan(0)
  })

  it('scores a lone first pick when no legal second survives', () => {
    const board = filledBoard(2)
    const draft = inferDraftState(board)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const candidate = boardGrid(board.layout).vertexIds[0]
    const blocked = new Set(boardGrid(board.layout).vertexIds)
    blocked.delete(candidate)
    const result = rankCandidates(ctx, board, draft, [{
      blocked,
      taken: [],
      pickerIds: [],
      uniforms: draft.sequence.map(() => 0),
    }], 54)
    const entry = result.recommendations.find((recommendation) => recommendation.firstPick === candidate)
    expect(entry).toBeDefined()
    expect(entry!.plannedSecond).toEqual([])
    expect(entry!.score).toBeCloseTo(marginalTotal(
      ctx,
      emptyHoldings(),
      candidate,
    ))
  })

  // A recommendation only needs one surviving window to be listed, and the modal window need not
  // be it. Walking such a candidate against the modal occupancy would draw a road out of a vertex
  // a rival holds in that window, which is a placement the window made illegal.
  it('draws the first road from a window the recommendation is placeable in', () => {
    const board = filledBoard(2)
    const draft = inferDraftState(board)
    const weights = { ...DEFAULT_WEIGHTS, expansionWeight: 1 }
    const ctx = computeBoardContext(board, weights)
    const candidate = 'v:-1,-1;-1,0;0,-1' as VertexId
    const pieces = occupancyFromBoard(board)
    const roadUnder = (occupied: ReadonlySet<VertexId>) =>
      expansionTerm(ctx, emptyHoldings(), { ...pieces, blocked: occupied, seat: 'aki' }, candidate).road

    // The modal window takes the far end of the road an unobstructed walk would lay. That bars the
    // candidate by the distance rule and makes a rival settlement of the very site the road went
    // to, so the modal reading is both illegal and a different answer.
    const openRoad = roadUnder(new Set())
    expect(openRoad).not.toBeNull()
    const takenBySeat = edgeEndpointVertexIds(openRoad!).find((vertexId) => vertexId !== candidate)!
    const modalBlocked = blockedVertices(board.layout, [takenBySeat])
    expect(modalBlocked.has(candidate)).toBe(true)
    // The second window takes nothing and leaves the candidate the only vertex open, so the pick
    // survives there and nowhere else.
    const survivable = new Set(boardGrid(board.layout).vertexIds)
    survivable.delete(candidate)
    const preWindows: PreWindowResult[] = [
      {
        blocked: modalBlocked,
        taken: [takenBySeat],
        pickerIds: ['p2'],
        uniforms: draft.sequence.map(() => 0),
      },
      {
        blocked: survivable,
        taken: [],
        pickerIds: [],
        uniforms: draft.sequence.map(() => 0),
      },
    ]

    const result = rankCandidates(ctx, board, draft, preWindows, 54)
    const entry = result.recommendations.find((recommendation) => recommendation.firstPick === candidate)
    expect(entry).toBeDefined()
    expect(entry!.survival).toBe(0.5)
    expect(entry!.firstRoad).toBe(openRoad)
    expect(roadUnder(new Set([takenBySeat]))).not.toBe(openRoad)
  })

  it('preserves structured pre-window take frequencies when all survival is zero', () => {
    const board = filledBoard(2)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const draft = inferDraftState(board)
    const allBlocked = new Set(boardGrid(board.layout).vertexIds)
    const [firstTake, secondTake] = boardGrid(board.layout).vertexIds
    const preWindows: PreWindowResult[] = [
      {
        blocked: new Set(allBlocked),
        taken: [firstTake, secondTake],
        pickerIds: ['p2', 'p2'],
        uniforms: draft.sequence.map(() => 0),
      },
      {
        blocked: new Set(allBlocked),
        taken: [firstTake],
        pickerIds: ['p2'],
        uniforms: draft.sequence.map(() => 0),
      },
    ]
    const result = rankCandidates(ctx, board, draft, preWindows, 54)
    expect(result.recommendations).toEqual([])
    // takenBeforeFirstPick reflects the modal (first) pre-window in pick order,
    // each spot annotated with its picker and frequency across all rollouts.
    expect(result.takenBeforeFirstPick).toEqual([
      { vertexId: firstTake, playerId: 'p2', frequency: 1 },
      { vertexId: secondTake, playerId: 'p2', frequency: 0.5 },
    ])
  })

  it('implements the complete status precedence in one resolver', () => {
    const base = {
      complete: false,
      meValid: true,
      meDone: false,
      legalCount: 1,
      hasPositiveScore: true,
      recommendationCount: 1,
    }
    expect(resolveStatus({ ...base, complete: true, meValid: false })).toBe('complete')
    expect(resolveStatus({ ...base, meValid: false, meDone: true })).toBe('no-me')
    expect(resolveStatus({ ...base, meDone: true, legalCount: 0 })).toBe('me-done')
    expect(resolveStatus({ ...base, legalCount: 0, hasPositiveScore: false })).toBe('no-availability')
    expect(resolveStatus({ ...base, hasPositiveScore: false, recommendationCount: 0 })).toBe('no-production')
    expect(resolveStatus({ ...base, recommendationCount: 0 })).toBe('no-availability')
    expect(resolveStatus(base)).toBe('ready')
  })
})
