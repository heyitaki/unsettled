import { boardGrid } from '../model/layouts'
import type { Board, EdgeId, LayoutId, VertexId } from '../model/types'
import { draftIsComplete, inferDraftState, type DraftState, type DraftWarning } from './draft'
import { expansionTerm } from './expansion'
import {
  blockedVertices,
  blockVertex,
  legalSettlementVertices,
  vertexAdjacency,
} from './legality'
import { neutralModifier, type PlacementModifier } from './modifiers'
import { mulberry32 } from './random'
import {
  addToHoldings,
  breakdownTotal,
  computeBoardContext,
  emptyHoldings,
  marginalParts,
  marginalTotal,
  marginalWithoutExpansion,
  occupancyFromBoard,
  scoreCandidate,
  type BoardContext,
  type DraftSlot,
  type HandCounts,
  type Holdings,
  type Occupancy,
  type ScoreBreakdown,
} from './valuation'
import { DEFAULT_WEIGHTS, type EngineWeights } from './weights'

export type AnalysisStatus =
  | 'ready'
  | 'no-me'
  | 'me-done'
  | 'complete'
  | 'no-production'
  | 'no-availability'

export interface TakenVertex {
  vertexId: VertexId
  playerId: string
  frequency: number
}

export interface Recommendation {
  firstPick: VertexId
  plannedSecond: VertexId[]
  /**
   * The setup road SP3's expansion walk would lay from `firstPick`, or null when the walk is off
   * (`expansionWeight` 0) or the pick opens nothing. See `expansion.ts::expansionTerm`.
   */
  firstRoad: EdgeId | null
  survival: number
  score: number
  rankScore: number
  breakdown: ScoreBreakdown
  expectedTaken: VertexId[]
}

export interface AnalysisOptions {
  seed?: number
  rollouts?: number
  weights?: EngineWeights
  modifier?: PlacementModifier
  maxResults?: number
}

export interface DraftAnalysis {
  status: AnalysisStatus
  draft: DraftState
  recommendations: Recommendation[]
  takenBeforeFirstPick: TakenVertex[]
  warnings: DraftWarning[]
}

export interface PreWindowResult {
  blocked: Set<VertexId>
  taken: readonly VertexId[]
  pickerIds?: readonly string[]
  uniforms?: readonly number[]
}

interface WindowResult {
  holdings: Map<string, Holdings>
  pickerIds: string[]
  taken: VertexId[]
}

interface CandidateAggregate {
  breakdown: ScoreBreakdown
  expectedTaken: Map<VertexId, number>
  plannedSecond: Map<VertexId, number>
  survived: number
}

interface ScoredTurn {
  playerId: string
  receivesGrant: boolean
  /** A seat with a pick still to come is choosing a first settlement, priced as a pair. */
  hasLaterPick: boolean
}

interface DraftTurn extends ScoredTurn {
  turnIndex: number
}

const emptyBreakdown = (): ScoreBreakdown => ({
  production: 0,
  scarcity: 0,
  robber: 0,
  diversity: 0,
  port: 0,
  handValue: 0,
  expansion: 0,
})

const addBreakdown = (target: ScoreBreakdown, value: ScoreBreakdown): void => {
  target.production += value.production
  target.scarcity += value.scarcity
  target.robber += value.robber
  target.diversity += value.diversity
  target.port += value.port
  target.handValue += value.handValue
  target.expansion += value.expansion
}

const receivesSecondSettlementGrant = (
  draft: DraftState,
  turnIndex: number,
): boolean => {
  const playerId = draft.sequence[turnIndex]
  if (playerId === undefined) return false
  let earlierPicks = 0
  for (let index = 0; index < turnIndex; index += 1) {
    if (draft.sequence[index] === playerId) earlierPicks += 1
  }
  return earlierPicks === 1
}

const handForCandidate = (
  ctx: BoardContext,
  vertexId: VertexId,
  receivesGrant: boolean,
): HandCounts | null => receivesGrant
  ? ctx.stats.get(vertexId)?.setupGrant ?? null
  : null

function remainingTurns(
  draft: DraftState,
  startIndex: number,
  endIndex: number,
  excludedPlayerId: string | null,
): DraftTurn[] {
  return draft.remainingPickIndices
    .filter((turnIndex) => turnIndex >= startIndex && turnIndex < endIndex)
    .map((turnIndex) => {
      const playerId = draft.sequence[turnIndex]
      return {
        playerId,
        receivesGrant: receivesSecondSettlementGrant(draft, turnIndex),
        // Searched past the window on purpose: a seat's later pick usually falls outside it.
        hasLaterPick: draft.remainingPickIndices.some((index) =>
          index > turnIndex && draft.sequence[index] === playerId),
        turnIndex,
      }
    })
    .filter(({ playerId }) => excludedPlayerId === null || playerId !== excludedPlayerId)
}

const holdingsFromBoard = (ctx: BoardContext, board: Board): Map<string, Holdings> => {
  const holdings = new Map(board.players.map((player) => [player.id, emptyHoldings()]))
  for (const building of board.buildings) {
    const current = holdings.get(building.playerId) ?? emptyHoldings()
    holdings.set(building.playerId, addToHoldings(ctx, current, building.vertexId))
  }
  return holdings
}

/**
 * A rollout's occupancy: the board's roads, since rollouts place none, beside the settlements
 * standing at score time, which are the board's buildings plus the vertices the rollout's windows
 * actually took. The set is held by reference, so a vertex settled mid-window is occupied for
 * every later scan in that window.
 *
 * It records the settlements themselves, never the wider set the distance rule bars building on.
 * Those two readings are not interchangeable: the walk in `expansion.ts` applies the distance rule
 * itself, and treats an occupied vertex as a rival's dead end unless the seat's own holdings claim
 * it. Feeding it the distance-closed set made a vertex barred only by the scoring player's own
 * settlement stop the walk, so the same board read a smaller expansion component on the second
 * pick than on the first. Every scan in the analysis reads this, both of my picks included, so no
 * two of them disagree about what is standing. Inert while `expansionWeight` is 0.
 */
const rolloutOccupancy = (
  board: Board,
  occupied: ReadonlySet<VertexId>,
  seat: string | null,
): Occupancy => ({
  blocked: occupied,
  edgeOwner: occupancyFromBoard(board).edgeOwner,
  seat,
})

/** The board's settled vertices, which every rollout occupancy starts from. */
const boardSettlements = (board: Board): ReadonlySet<VertexId> => occupancyFromBoard(board).blocked

/**
 * The draft slot a player picks from: its index in `board.players`, which is what `draft.ts`
 * builds the pick order from in both directions of the snake, beside the seat count. Null for a
 * player the board does not list, which scores unscaled.
 */
const draftSlotOf = (board: Board, playerId: string): DraftSlot | null => {
  const slot = board.players.findIndex((player) => player.id === playerId)
  return slot < 0 ? null : { seats: board.players.length, slot }
}

const scoreForScan = (
  ctx: BoardContext,
  board: Board,
  holdings: Holdings,
  vertexId: VertexId,
  playerId: string,
  modifier: PlacementModifier,
  receivesGrant: boolean,
  occupancy: Occupancy,
  slot: DraftSlot | null,
): number => modifier === neutralModifier
  ? marginalTotal(
      ctx,
      holdings,
      vertexId,
      handForCandidate(ctx, vertexId, receivesGrant),
      occupancy,
      slot,
    )
  : scoreCandidate(
      ctx,
      holdings,
      vertexId,
      playerId,
      board,
      modifier,
      handForCandidate(ctx, vertexId, receivesGrant),
      occupancy,
      slot,
    ).total

function bestLegalCandidate(
  ctx: BoardContext,
  board: Board,
  holdings: Holdings,
  blocked: ReadonlySet<VertexId>,
  occupied: ReadonlySet<VertexId>,
  playerId: string,
  modifier: PlacementModifier,
  receivesGrant: boolean,
): VertexId | null {
  let best: VertexId | null = null
  let bestScore = -Infinity
  const occupancy = rolloutOccupancy(board, occupied, playerId)
  const slot = draftSlotOf(board, playerId)
  for (const vertexId of boardGrid(board.layout).vertexIds) {
    if (blocked.has(vertexId)) continue
    const score = scoreForScan(
      ctx,
      board,
      holdings,
      vertexId,
      playerId,
      modifier,
      receivesGrant,
      occupancy,
      slot,
    )
    if (score > bestScore) {
      best = vertexId
      bestScore = score
    }
  }
  return best
}

/**
 * The partner half of a first settlement's pair value, tabulated once per analysis.
 *
 * A rival with a pick still to come is choosing a first settlement, and what it is worth is the
 * pair it leads to: its own score plus the best second settlement that candidate opens. The
 * second's score without its expansion component depends only on the two vertices and the seat's
 * draft slot, because a first pick starts from empty holdings and a second settlement always
 * receives the setup grant; so the partner scores are tabulated by grid index the first time a
 * slot is asked for, and every rollout scan after that reads them. The expansion component is the
 * one part that moves with the board's occupancy, so `opponentPick` adds it per scan from the
 * values it already has.
 */
const partnerTables = new WeakMap<BoardContext, Map<string, Float64Array[]>>()

/** Row `first`, column `second`, both grid indices: the second's score without expansion. */
function partnerTable(ctx: BoardContext, slot: DraftSlot | null): readonly Float64Array[] {
  let tables = partnerTables.get(ctx)
  if (!tables) {
    tables = new Map()
    partnerTables.set(ctx, tables)
  }
  const key = slot === null ? '' : `${slot.seats}/${slot.slot}`
  const cached = tables.get(key)
  if (cached) return cached
  const vertexIds = boardGrid(ctx.layout).vertexIds
  const rows = vertexIds.map((first) => {
    const holdings = addToHoldings(ctx, emptyHoldings(), first)
    return Float64Array.from(vertexIds, (second) => marginalWithoutExpansion(
      ctx,
      holdings,
      second,
      handForCandidate(ctx, second, true),
      slot,
    ))
  })
  tables.set(key, rows)
  return rows
}

/**
 * Below this, two pair scores are the same pair read in either order: the pair value is symmetric
 * apart from float noise unless the grant is priced, and noise must not decide which half goes
 * first.
 */
export const PAIR_TIE = 1e-9

/**
 * Each legal candidate's best partner as an index into `legal`, or -1 when no legal vertex is
 * clear of it, in which case that candidate is priced alone beside rivals priced as pairs, and
 * the partner's value, 0 when there is none.
 */
function bestPartners(
  layout: LayoutId,
  legal: readonly VertexId[],
  gridIndex: readonly number[],
  partners: readonly Float64Array[],
  expansion: readonly number[],
): { mate: number[]; value: number[] } {
  const adjacency = vertexAdjacency(layout)
  const count = legal.length
  const position = new Map(legal.map((vertexId, index) => [vertexId, index]))
  // Positions the current row cannot pair with: itself and its neighbours, marked then unmarked.
  const skip = new Uint8Array(count)
  const mate: number[] = []
  const value: number[] = []
  for (let index = 0; index < count; index += 1) {
    const row = partners[gridIndex[index]]
    const adjacent = adjacency.get(legal[index]) ?? []
    skip[index] = 1
    for (const neighbour of adjacent) {
      const at = position.get(neighbour)
      if (at !== undefined) skip[at] = 1
    }
    let best = -Infinity
    let bestIndex = -1
    for (let other = 0; other < count; other += 1) {
      if (skip[other] === 1) continue
      const partner = row[gridIndex[other]] + expansion[other]
      if (partner > best) {
        best = partner
        bestIndex = other
      }
    }
    skip[index] = 0
    for (const neighbour of adjacent) {
      const at = position.get(neighbour)
      if (at !== undefined) skip[at] = 0
    }
    mate.push(bestIndex)
    value.push(bestIndex < 0 ? 0 : best)
  }
  return { mate, value }
}

/**
 * A rival's pick: the softmax over its top candidates, each priced as a pair when the rival has
 * a pick still to come and holds nothing yet, and alone otherwise, since holdings already carry
 * the first settlement a last pick is completing.
 *
 * The pair value is the unordered pair's, so its two halves would tie to the bit and the softmax
 * would split one plan across two candidates. A player planning a pair takes its contested half
 * first, so when two candidates are each other's best partner only the one worth more alone
 * stays a candidate; the weaker half is the one more likely to still be there. A priced grant
 * breaks the symmetry, and then the orientation worth more is the one that stays.
 *
 * The pair value assumes the planned second survives the picks in between, and prices its
 * expansion against the current occupancy with empty holdings rather than the candidate. The
 * hero's own ranking rolls the picks in between out instead, so the two views agree on the pick
 * and not to the decimal. A modifier reaches the candidate's own score and, through the walk's
 * value, the partner's expansion component; the rest of the partner is read from the table.
 */
function opponentPick(
  ctx: BoardContext,
  board: Board,
  playerId: string,
  holdings: Holdings,
  blocked: ReadonlySet<VertexId>,
  occupied: ReadonlySet<VertexId>,
  uniform: number,
  modifier: PlacementModifier,
  receivesGrant: boolean,
  hasLaterPick: boolean,
): VertexId | null {
  const topVertices: VertexId[] = []
  const topScores: number[] = []
  const topK = Math.max(1, ctx.weights.opponentTopK)
  const occupancy = rolloutOccupancy(board, occupied, playerId)
  const slot = draftSlotOf(board, playerId)
  const partners = hasLaterPick && holdings.vertices.length === 0
    ? partnerTable(ctx, slot)
    : null
  const legal: VertexId[] = []
  const gridIndex: number[] = []
  const own: number[] = []
  const expansion: number[] = []
  for (const [index, vertexId] of boardGrid(board.layout).vertexIds.entries()) {
    if (blocked.has(vertexId)) continue
    legal.push(vertexId)
    if (partners === null) {
      own.push(scoreForScan(
        ctx,
        board,
        holdings,
        vertexId,
        playerId,
        modifier,
        receivesGrant,
        occupancy,
        slot,
      ))
      continue
    }
    gridIndex.push(index)
    // The scan's two halves kept apart: the walk's value is also the partner's expansion.
    const hand = handForCandidate(ctx, vertexId, receivesGrant)
    let scored: { expansion: number; total: number }
    if (modifier === neutralModifier) {
      scored = marginalParts(ctx, holdings, vertexId, hand, occupancy, slot)
    } else {
      const full = scoreCandidate(
        ctx, holdings, vertexId, playerId, board, modifier, hand, occupancy, slot,
      )
      scored = { expansion: full.breakdown.expansion, total: full.total }
    }
    expansion.push(scored.expansion)
    own.push(scored.total)
  }
  const plan = partners === null
    ? null
    : bestPartners(board.layout, legal, gridIndex, partners, expansion)
  for (const [index, vertexId] of legal.entries()) {
    let score = own[index]
    if (plan !== null) {
      score += plan.value[index]
      const other = plan.mate[index]
      if (other >= 0 && plan.mate[other] === index) {
        // The grant goes to the second settlement, so with it priced the two orientations of a
        // pair differ and the better one is the candidate; otherwise they tie to the bit and the
        // half worth more alone goes first.
        const gap = score - (own[other] + plan.value[other])
        const weaker = Math.abs(gap) > PAIR_TIE
          ? gap < 0
          : own[other] > own[index] || (own[other] === own[index] && other < index)
        if (weaker) continue
      }
    }
    let rank = 0
    while (rank < topScores.length && score <= topScores[rank]) rank += 1
    if (rank >= topK) continue
    topVertices.splice(rank, 0, vertexId)
    topScores.splice(rank, 0, score)
    if (topVertices.length > topK) {
      topVertices.pop()
      topScores.pop()
    }
  }
  if (topVertices.length === 0) return null
  if (uniform <= 0 || ctx.weights.softmaxTemperature <= 0) return topVertices[0]
  const maximum = topScores[0]
  let total = 0
  const probabilities: number[] = []
  for (const score of topScores) {
    const probability = Math.exp((score - maximum) / ctx.weights.softmaxTemperature)
    probabilities.push(probability)
    total += probability
  }
  let threshold = uniform * total
  for (let index = 0; index < probabilities.length; index += 1) {
    threshold -= probabilities[index]
    if (threshold <= 0) return topVertices[index]
  }
  return topVertices.at(-1) ?? null
}

function simulateWindowDetailed(
  ctx: BoardContext,
  board: Board,
  turns: readonly ScoredTurn[],
  initialHoldings: ReadonlyMap<string, Holdings>,
  blocked: Set<VertexId>,
  occupied: Set<VertexId>,
  nextUniform: () => number,
  modifier: PlacementModifier,
): WindowResult {
  const holdings = new Map(initialHoldings)
  const taken: VertexId[] = []
  const actualPickers: string[] = []
  const adjacency = vertexAdjacency(board.layout)
  for (const { playerId, receivesGrant, hasLaterPick } of turns) {
    const uniform = nextUniform()
    const held = holdings.get(playerId) ?? emptyHoldings()
    const vertexId = opponentPick(
      ctx,
      board,
      playerId,
      held,
      blocked,
      occupied,
      uniform,
      modifier,
      receivesGrant,
      hasLaterPick,
    )
    if (vertexId === null) continue
    blockVertex(adjacency, blocked, vertexId)
    occupied.add(vertexId)
    holdings.set(playerId, addToHoldings(ctx, held, vertexId))
    taken.push(vertexId)
    actualPickers.push(playerId)
  }
  return { holdings, pickerIds: actualPickers, taken }
}

/**
 * Exported for tests: exercises defensive branches unreachable from valid boards, and the pair
 * pricing of a first settlement when every picker is given a later pick.
 */
export function simulateOpponentWindow(
  ctx: BoardContext,
  board: Board,
  pickerIds: readonly string[],
  holdings: ReadonlyMap<string, Holdings>,
  blocked: Set<VertexId>,
  nextUniform: () => number,
  modifier: PlacementModifier,
  hasLaterPick = false,
): VertexId[] {
  return simulateWindowDetailed(
    ctx,
    board,
    pickerIds.map((playerId) => ({ playerId, receivesGrant: false, hasLaterPick })),
    holdings,
    blocked,
    new Set(boardSettlements(board)),
    nextUniform,
    modifier,
  ).taken
}

const frequencyOrder = (
  counts: ReadonlyMap<VertexId, number>,
  denominator: number,
  gridIndex: ReadonlyMap<VertexId, number>,
  threshold = 0,
): { vertexId: VertexId; frequency: number }[] =>
  [...counts]
    .filter(([, count]) => count / denominator >= threshold)
    .map(([vertexId, count]) => ({ vertexId, frequency: count / denominator }))
    .sort((a, b) => b.frequency - a.frequency ||
      (gridIndex.get(a.vertexId) ?? 0) - (gridIndex.get(b.vertexId) ?? 0))

function replayPreWindowHoldings(
  ctx: BoardContext,
  board: Board,
  draft: DraftState,
  preWindow: PreWindowResult,
  firstPickIndex: number,
): Map<string, Holdings> {
  const holdings = holdingsFromBoard(ctx, board)
  const scheduled = remainingTurns(
    draft,
    draft.turnIndex ?? firstPickIndex,
    firstPickIndex,
    board.mePlayerId,
  ).map(({ playerId }) => playerId)
  for (let index = 0; index < preWindow.taken.length; index += 1) {
    const playerId = preWindow.pickerIds?.[index] ?? scheduled[index]
    if (playerId === undefined) continue
    const held = holdings.get(playerId) ?? emptyHoldings()
    holdings.set(playerId, addToHoldings(ctx, held, preWindow.taken[index]))
  }
  return holdings
}

/**
 * The lowest-index pre-window the candidate is placeable in. Every listed recommendation survived
 * at least one, so the fallback to the modal window is unreachable from `rankCandidates`.
 */
const firstSurvivingWindow = (
  preWindows: readonly PreWindowResult[],
  candidate: VertexId,
): number => Math.max(0, preWindows.findIndex((preWindow) => !preWindow.blocked.has(candidate)))

/**
 * Exported for tests: exercises defensive branches unreachable from valid boards.
 */
export function rankCandidates(
  ctx: BoardContext,
  board: Board,
  draft: DraftState,
  preWindows: readonly PreWindowResult[],
  options: Required<AnalysisOptions>,
): { recommendations: Recommendation[]; takenBeforeFirstPick: TakenVertex[] } {
  const grid = boardGrid(board.layout)
  const gridIndex = new Map(grid.vertexIds.map((vertexId, index) => [vertexId, index]))
  const takenCounts = new Map<VertexId, number>()
  for (const preWindow of preWindows) {
    for (const vertexId of preWindow.taken) {
      takenCounts.set(vertexId, (takenCounts.get(vertexId) ?? 0) + 1)
    }
  }
  const denominator = Math.max(1, preWindows.length)
  // Show the "likely gone" spots from the deterministic (modal) rollout, where
  // every opponent takes its top choice. Its picks are
  // mutually legal (a real snake draft can never take two spots a single road
  // apart), ordered by draft turn, and each carries the player who takes it.
  // Frequency across all rollouts annotates how reliably that exact spot goes.
  const modal = preWindows[0]
  const takenBeforeFirstPick: TakenVertex[] = (modal?.taken ?? []).map((vertexId, index) => ({
    vertexId,
    playerId: modal.pickerIds?.[index] ?? '',
    frequency: (takenCounts.get(vertexId) ?? 0) / denominator,
  }))
  const firstPickIndex = draft.myRemainingPickIndices[0]
  if (firstPickIndex === undefined || preWindows.length === 0 || board.mePlayerId === null) {
    return { recommendations: [], takenBeforeFirstPick }
  }
  const me = board.mePlayerId
  const secondPickIndex = draft.myRemainingPickIndices[1]
  const midTurns = secondPickIndex === undefined
    ? []
    : remainingTurns(draft, firstPickIndex + 1, secondPickIndex, me)
  const candidates = legalSettlementVertices(board)
  const myHoldings = holdingsFromBoard(ctx, board).get(me) ?? emptyHoldings()
  const firstReceivesGrant = receivesSecondSettlementGrant(draft, firstPickIndex)
  // Both of my picks come off the same slot: the snake reverses the order seats pick in, never
  // which seat I am.
  const mySlot = draftSlotOf(board, me)
  const aggregates = new Map<VertexId, CandidateAggregate>()
  const adjacency = vertexAdjacency(board.layout)
  // The settlements standing once each pre-window has run: the board's own beside the vertices
  // that window took. Folded once per window rather than per candidate, since the candidate loop
  // rebuilds one of these per pre-window it survives.
  const settled = boardSettlements(board)
  const preWindowOccupied = preWindows.map((preWindow) =>
    new Set<VertexId>([...settled, ...preWindow.taken]))
  // One occupancy per window, shared by every candidate scored against it.
  const preWindowOccupancy = preWindowOccupied.map((occupied) =>
    rolloutOccupancy(board, occupied, me))
  const preWindowHoldings = preWindows.map((preWindow) =>
    replayPreWindowHoldings(ctx, board, draft, preWindow, firstPickIndex))

  for (const candidate of candidates) {
    const aggregate: CandidateAggregate = {
      breakdown: emptyBreakdown(),
      expectedTaken: new Map(),
      plannedSecond: new Map(),
      survived: 0,
    }
    const firstHand = handForCandidate(ctx, candidate, firstReceivesGrant)
    for (const [windowIndex, preWindow] of preWindows.entries()) {
      if (preWindow.blocked.has(candidate)) continue
      aggregate.survived += 1
      // Scored per window rather than once against the bare board: by the time I pick, the seats
      // ahead of me have taken the vertices this window records, and the expansion walk reads
      // those as occupied. Expansion is the only component that moves between windows; the other
      // six are recomputed alongside it so a modifier still sees one whole breakdown.
      const firstScore = scoreCandidate(
        ctx,
        myHoldings,
        candidate,
        me,
        board,
        options.modifier,
        firstHand,
        preWindowOccupancy[windowIndex],
        mySlot,
      )
      addBreakdown(aggregate.breakdown, firstScore.breakdown)
      for (const vertexId of preWindow.taken) {
        aggregate.expectedTaken.set(vertexId, (aggregate.expectedTaken.get(vertexId) ?? 0) + 1)
      }
      if (secondPickIndex === undefined) continue

      const blocked = new Set(preWindow.blocked)
      blockVertex(adjacency, blocked, candidate)
      // Grows with the mid-window's picks below, so the second pick is scored against every
      // settlement standing by then.
      const occupied = new Set(preWindowOccupied[windowIndex])
      occupied.add(candidate)
      const firstHoldings = addToHoldings(ctx, myHoldings, candidate)
      const opponentHoldings = preWindowHoldings[windowIndex]
      let uniformIndex = 0
      const nextUniform = () =>
        preWindow.uniforms?.[midTurns[uniformIndex++]?.turnIndex ?? 0] ?? 0
      const midWindow = simulateWindowDetailed(
        ctx,
        board,
        midTurns,
        opponentHoldings,
        blocked,
        occupied,
        nextUniform,
        options.modifier,
      )
      for (const vertexId of midWindow.taken) {
        aggregate.expectedTaken.set(vertexId, (aggregate.expectedTaken.get(vertexId) ?? 0) + 1)
      }
      const second = bestLegalCandidate(
        ctx,
        board,
        firstHoldings,
        blocked,
        occupied,
        me,
        options.modifier,
        receivesSecondSettlementGrant(draft, secondPickIndex),
      )
      if (second === null) continue
      const secondScore = scoreCandidate(
        ctx,
        firstHoldings,
        second,
        me,
        board,
        options.modifier,
        handForCandidate(
          ctx,
          second,
          receivesSecondSettlementGrant(draft, secondPickIndex),
        ),
        rolloutOccupancy(board, occupied, me),
        mySlot,
      )
      addBreakdown(aggregate.breakdown, secondScore.breakdown)
      aggregate.plannedSecond.set(second, (aggregate.plannedSecond.get(second) ?? 0) + 1)
    }
    aggregates.set(candidate, aggregate)
  }

  const recommendations: Recommendation[] = []
  for (const candidate of candidates) {
    const aggregate = aggregates.get(candidate)
    if (!aggregate || aggregate.survived === 0) continue
    const breakdown: ScoreBreakdown = {
      production: aggregate.breakdown.production / aggregate.survived,
      scarcity: aggregate.breakdown.scarcity / aggregate.survived,
      robber: aggregate.breakdown.robber / aggregate.survived,
      diversity: aggregate.breakdown.diversity / aggregate.survived,
      port: aggregate.breakdown.port / aggregate.survived,
      handValue: aggregate.breakdown.handValue / aggregate.survived,
      expansion: aggregate.breakdown.expansion / aggregate.survived,
    }
    const survival = aggregate.survived / preWindows.length
    const score = breakdownTotal(breakdown)
    recommendations.push({
      firstPick: candidate,
      // Filled in below, once the list has been cut to the results the panel shows.
      firstRoad: null,
      plannedSecond: frequencyOrder(
        aggregate.plannedSecond,
        aggregate.survived,
        gridIndex,
      ).slice(0, 3).map(({ vertexId }) => vertexId),
      survival,
      score,
      rankScore: survival * score,
      breakdown,
      expectedTaken: frequencyOrder(
        aggregate.expectedTaken,
        aggregate.survived,
        gridIndex,
        0.5,
      ).map(({ vertexId }) => vertexId),
    })
  }
  recommendations.sort((a, b) => b.rankScore - a.rankScore ||
    (gridIndex.get(a.firstPick) ?? 0) - (gridIndex.get(b.firstPick) ?? 0))
  // The road the expansion walk would lay from each first pick. The scoring above already ran the
  // walk, but the term reports only its value, so the direction is asked for separately. Asked
  // after the cut, because the walk is the expensive half of the term and every candidate the
  // panel will not show is a walk nobody reads. Read off the lowest-index window the candidate
  // survived, which for all but a blocked-in-the-modal-window candidate is the modal window
  // itself, the same rollout `takenBeforeFirstPick` draws its "likely gone" spots from, so the
  // drawn road and the drawn losses agree. A recommendation the modal window blocked has to read
  // some other window: its score already averages only the windows it survived, and walking it
  // against an occupancy that holds a rival on or beside the vertex would draw a road out of a
  // placement that window made illegal.
  return {
    recommendations: recommendations.slice(0, options.maxResults).map((recommendation) => ({
      ...recommendation,
      firstRoad: expansionTerm(
        ctx,
        myHoldings,
        preWindowOccupancy[firstSurvivingWindow(preWindows, recommendation.firstPick)],
        recommendation.firstPick,
      ).road,
    })),
    takenBeforeFirstPick,
  }
}

/**
 * Exported for tests: this is the single status precedence implementation.
 */
export function resolveStatus(input: {
  complete: boolean
  meValid: boolean
  meDone: boolean
  legalCount: number
  hasPositiveScore: boolean
  recommendationCount: number
}): AnalysisStatus {
  if (input.complete) return 'complete'
  if (!input.meValid) return 'no-me'
  if (input.meDone) return 'me-done'
  if (input.legalCount === 0) return 'no-availability'
  if (!input.hasPositiveScore) return 'no-production'
  if (input.recommendationCount === 0) return 'no-availability'
  return 'ready'
}

export function rolloutCount(
  legalCount: number,
  prePicks: number,
  midPicks: number,
  weights: EngineWeights,
): number {
  const costPerRollout =
    prePicks * legalCount +
    legalCount * (midPicks + 1) * legalCount
  const budgeted = Math.floor(weights.rolloutBudget / Math.max(1, costPerRollout))
  return Math.max(weights.rolloutsMin, Math.min(weights.rolloutsMax, budgeted))
}

export function analyzeBoard(board: Board, options: AnalysisOptions = {}): DraftAnalysis {
  const weights = options.weights ?? DEFAULT_WEIGHTS
  const modifier = options.modifier ?? neutralModifier
  const draft = inferDraftState(board)
  const ctx = computeBoardContext(board, weights)
  const legal = legalSettlementVertices(board)
  const complete = draftIsComplete(board, draft)
  const meValid = board.mePlayerId !== null &&
    board.players.some((player) => player.id === board.mePlayerId)
  const meDone = draft.myRemainingPickIndices.length === 0
  const me = board.mePlayerId
  const boardOccupancy = occupancyFromBoard(board, me)
  const mySlot = me === null ? null : draftSlotOf(board, me)
  const baseHoldings = holdingsFromBoard(ctx, board)
  const myHoldings = me === null ? emptyHoldings() : baseHoldings.get(me) ?? emptyHoldings()
  const canRank = !complete && meValid && !meDone && legal.length > 0 && me !== null
  const pendingPickIndex = draft.myRemainingPickIndices[0]
  const pendingReceivesGrant = pendingPickIndex !== undefined &&
    receivesSecondSettlementGrant(draft, pendingPickIndex)
  const hasPositiveScore = canRank && legal.some((vertexId) =>
    scoreForScan(
      ctx,
      board,
      myHoldings,
      vertexId,
      me,
      modifier,
      pendingReceivesGrant,
      boardOccupancy,
      mySlot,
    ) > 0)
  const shouldRank = canRank && hasPositiveScore
  let recommendations: Recommendation[] = []
  let takenBeforeFirstPick: TakenVertex[] = []

  if (shouldRank && me !== null) {
    const firstPickIndex = draft.myRemainingPickIndices[0]
    const secondPickIndex = draft.myRemainingPickIndices[1]
    const turnIndex = draft.turnIndex ?? firstPickIndex
    const preTurns = remainingTurns(draft, turnIndex, firstPickIndex, me)
    const midPicks = secondPickIndex === undefined
      ? 0
      : remainingTurns(draft, firstPickIndex + 1, secondPickIndex, me).length
    const rollouts = options.rollouts ??
      rolloutCount(legal.length, preTurns.length, midPicks, weights)
    const random = mulberry32(options.seed ?? 7)
    const uniforms = Array.from({ length: rollouts }, () =>
      Array.from({ length: draft.sequence.length }, () => random()))
    const baseBlocked = blockedVertices(
      board.layout,
      board.buildings.map((building) => building.vertexId),
    )
    const baseOccupied = boardSettlements(board)
    const preWindows: PreWindowResult[] = []
    for (let rollout = 0; rollout < rollouts; rollout += 1) {
      const blocked = new Set(baseBlocked)
      let uniformIndex = 0
      const nextUniform = () => rollout === 0
        ? 0
        : uniforms[rollout][preTurns[uniformIndex++]?.turnIndex ?? 0]
      const result = simulateWindowDetailed(
        ctx,
        board,
        preTurns,
        baseHoldings,
        blocked,
        new Set(baseOccupied),
        nextUniform,
        modifier,
      )
      preWindows.push({
        blocked,
        taken: result.taken,
        pickerIds: result.pickerIds,
        uniforms: rollout === 0
          ? Array.from({ length: draft.sequence.length }, () => 0)
          : uniforms[rollout],
      })
    }
    const ranked = rankCandidates(ctx, board, draft, preWindows, {
      seed: options.seed ?? 7,
      rollouts,
      weights,
      modifier,
      maxResults: options.maxResults ?? weights.maxResults,
    })
    recommendations = ranked.recommendations
    takenBeforeFirstPick = ranked.takenBeforeFirstPick
  }

  const status = resolveStatus({
    complete,
    meValid,
    meDone,
    legalCount: legal.length,
    hasPositiveScore,
    recommendationCount: recommendations.length,
  })
  return {
    status,
    draft,
    recommendations: status === 'ready' ? recommendations : [],
    takenBeforeFirstPick: status === 'no-availability' || status === 'ready'
      ? takenBeforeFirstPick
      : [],
    warnings: [...draft.warnings],
  }
}

// Default-options analysis memoized on board identity, so the panels that all
// need it per render (best picks, draft views) share one rollout pass. Boards
// are immutable — every edit is a new object — so identity is a safe key.
const analysisCache = new WeakMap<Board, DraftAnalysis>()

export function analyzeBoardCached(board: Board): DraftAnalysis {
  const hit = analysisCache.get(board)
  if (hit) return hit
  const analysis = analyzeBoard(board)
  analysisCache.set(board, analysis)
  return analysis
}
