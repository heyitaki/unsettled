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
import { edgeEndpointVertexIds, hexVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import type { Board, Resource, VertexId } from '../../model/types'
import {
  analyzeBoard,
  rankCandidates,
  resolveStatus,
  simulateOpponentWindow,
  type AnalysisOptions,
  type PreWindowResult,
} from '../analyze'
import { inferDraftState } from '../draft'
import { legalSettlementVertices } from '../legality'
import { neutralModifier, type PlacementModifier } from '../modifiers'
import {
  addToHoldings,
  computeBoardContext,
  emptyHoldings,
  scoreCandidate,
  type Holdings,
} from '../valuation'
import { DEFAULT_WEIGHTS } from '../weights'

const resources: readonly Resource[] = ['wood', 'sheep', 'wheat', 'brick', 'ore']
const tokens = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12] as const
// This coastal port vertex touches exactly one land hex (-2,0); its other two
// members are sea. So you can never double-down *on* the port — an on-port
// settlement gets at most one hex of the matched resource.
const PORT_EDGE = 'e:-3,0;-2,0' as const
const PORT_VERTEX = 'v:-3,0;-2,-1;-2,0' as const
const MIRROR_LEFT = PORT_VERTEX
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
// the legitimate niche. (A full "build toward a nearby port" bonus awaits the
// deferred near-port feature; on-port is capped at this single hex.)
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

const requiredOptions = (overrides: Partial<Required<AnalysisOptions>> = {}): Required<AnalysisOptions> => ({
  seed: 7,
  rollouts: 1,
  weights: DEFAULT_WEIGHTS,
  modifier: neutralModifier,
  maxResults: DEFAULT_WEIGHTS.maxResults,
  ...overrides,
})

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
        }
      | undefined
    for (let pattern = 0; pattern < 80 && witness === undefined; pattern += 1) {
      const board = filledBoard(2, pattern)
      const { ctx, holdings } = holdingsFor(board, 'aki')
      const singles = legalSettlementVertices(board)
        .map((vertexId) => ({
          vertexId,
          score: scoreCandidate(ctx, holdings, vertexId, 'aki', board, neutralModifier).total,
        }))
        .sort((a, b) => b.score - a.score)
      const [first, second] = singles
      const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
      const top = analysis.recommendations[0]
      const naiveEntry = analysis.recommendations.find((entry) => entry.firstPick === first.vertexId)
      if (top && naiveEntry &&
        top.firstPick !== first.vertexId &&
        top.rankScore > naiveEntry.rankScore + 0.5 &&
        naiveEntry.expectedTaken.includes(second.vertexId) &&
        naiveEntry.score < first.score + second.score) {
        witness = {
          analysis,
          board,
          n1: first.vertexId,
          n2: second.vertexId,
          naiveFirst: first.score,
          naiveSecond: second.score,
        }
      }
    }
    expect(witness).toBeDefined()
    const top = witness!.analysis.recommendations[0]
    const naiveEntry = witness!.analysis.recommendations.find((entry) => entry.firstPick === witness!.n1)!
    expect(top.firstPick).not.toBe(witness!.n1)
    expect(top.rankScore).toBeGreaterThan(naiveEntry.rankScore + 0.5)
    expect(naiveEntry.expectedTaken).toContain(witness!.n2)
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

  it('simulates opponents before a not-my-turn pick', () => {
    const board = setMe(filledBoard(5, 3), 'p4')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    expect(analysis.status).toBe('ready')
    expect(analysis.takenBeforeFirstPick.length).toBeGreaterThan(0)
    const { ctx } = holdingsFor(board, 'aki')
    const greedyBest = legalSettlementVertices(board)
      .map((vertexId) => ({
        vertexId,
        score: scoreCandidate(ctx, emptyHoldings(), vertexId, 'aki', board, neutralModifier).total,
      }))
      .sort((a, b) => b.score - a.score)[0].vertexId
    expect(analysis.takenBeforeFirstPick.map((entry) => entry.vertexId)).toContain(greedyBest)
    expect(analysis.recommendations.every((entry) => entry.survival > 0)).toBe(true)
  })

  it('conditions a one-pick remainder on the existing settlement', () => {
    const base = filledBoard(2, 5)
    const { ctx } = holdingsFor(base, 'aki')
    const existing = legalSettlementVertices(base)
      .sort((a, b) =>
        scoreCandidate(ctx, emptyHoldings(), b, 'aki', base, neutralModifier).total -
        scoreCandidate(ctx, emptyHoldings(), a, 'aki', base, neutralModifier).total)[0]
    const board = placeBuilding(base, existing, 'aki', 'settlement')
    const analysis = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    expect(analysis.status).toBe('ready')
    expect(analysis.recommendations.every((entry) => entry.plannedSecond.length === 0)).toBe(true)
    const existingHoldings = addToHoldings(ctx, emptyHoldings(), existing)
    expect(analysis.recommendations[0].score).toBeCloseTo(
      scoreCandidate(
        ctx,
        existingHoldings,
        analysis.recommendations[0].firstPick,
        'aki',
        board,
        neutralModifier,
      ).total,
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
    expect(analysis.recommendations[0].score).toBeCloseTo(scoreCandidate(
      ctx,
      holdings,
      analysis.recommendations[0].firstPick,
      'p2',
      board,
      neutralModifier,
    ).total)
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
    expect(analysis.recommendations.every((entry) => entry.expectedTaken.length === 1)).toBe(true)
  })

  it('routes a per-player modifier through opponent picks', () => {
    const board = setMe(filledBoard(3, 9), 'p2')
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const neutral = analyzeBoard(board, { rollouts: 1, maxResults: 54 })
    const brickSpot = neutral.recommendations
      .find((entry) => (ctx.stats.get(entry.firstPick)?.pips.brick ?? 0) > 0)!.firstPick
    const boost: PlacementModifier = (playerId, breakdown, modifierCtx) =>
      playerId === 'aki' && modifierCtx.vertexId === brickSpot
        ? { ...breakdown, production: breakdown.production + 1000 }
        : breakdown
    const modified = analyzeBoard(board, { rollouts: 1, modifier: boost, maxResults: 54 })
    expect(modified.takenBeforeFirstPick.map((entry) => entry.vertexId)).toContain(brickSpot)
    expect(modified.takenBeforeFirstPick).not.toEqual(neutral.takenBeforeFirstPick)
    const neutralBrick = neutral.recommendations.find((entry) => entry.firstPick === brickSpot)
    const modifiedBrick = modified.recommendations.find((entry) => entry.firstPick === brickSpot)
    expect(neutralBrick).toBeDefined()
    expect(neutralBrick!.survival).toBe(1)
    expect(modifiedBrick).toBeUndefined()
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
    expect(simulateOpponentWindow(
      ctx,
      board,
      ['p2'],
      new Map<string, Holdings>(),
      blocked,
      () => 0,
      neutralModifier,
    )).toEqual([])
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
    const result = rankCandidates(ctx, board, draft, [{ blocked, taken: [] }], requiredOptions({
      maxResults: 54,
    }))
    const entry = result.recommendations.find((recommendation) => recommendation.firstPick === candidate)
    expect(entry).toBeDefined()
    expect(entry!.plannedSecond).toEqual([])
    expect(entry!.score).toBeCloseTo(scoreCandidate(
      ctx,
      emptyHoldings(),
      candidate,
      'aki',
      board,
      neutralModifier,
    ).total)
  })

  it('preserves structured pre-window take frequencies when all survival is zero', () => {
    const board = filledBoard(2)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const draft = inferDraftState(board)
    const allBlocked = new Set(boardGrid(board.layout).vertexIds)
    const [firstTake, secondTake] = boardGrid(board.layout).vertexIds
    const preWindows: PreWindowResult[] = [
      { blocked: new Set(allBlocked), taken: [firstTake, secondTake] },
      { blocked: new Set(allBlocked), taken: [firstTake] },
    ]
    const result = rankCandidates(ctx, board, draft, preWindows, requiredOptions({ maxResults: 54 }))
    expect(result.recommendations).toEqual([])
    // takenBeforeFirstPick reflects the modal (first) pre-window in pick order,
    // each spot annotated with its frequency across all rollouts. These manual
    // preWindows carry no pickerIds, so playerId falls back to empty.
    expect(result.takenBeforeFirstPick).toEqual([
      { vertexId: firstTake, playerId: '', frequency: 1 },
      { vertexId: secondTake, playerId: '', frequency: 0.5 },
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
