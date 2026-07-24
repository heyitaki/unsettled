import { boardGrid } from '../model/layouts'
import type { Board, VertexId } from '../model/types'
import { draftIsComplete, inferDraftState, type DraftState, type DraftWarning } from './draft'
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
  fastMarginalTotal,
  scoreCandidate,
  type BoardContext,
  type Holdings,
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

interface DraftTurn {
  playerId: string
  turnIndex: number
}

const emptyBreakdown = (): ScoreBreakdown => ({
  production: 0,
  scarcity: 0,
  robber: 0,
  diversity: 0,
  port: 0,
})

const addBreakdown = (target: ScoreBreakdown, value: ScoreBreakdown): void => {
  target.production += value.production
  target.scarcity += value.scarcity
  target.robber += value.robber
  target.diversity += value.diversity
  target.port += value.port
}

function remainingTurns(
  draft: DraftState,
  startIndex: number,
  endIndex: number,
  excludedPlayerId: string | null,
): DraftTurn[] {
  return draft.remainingPickIndices
    .filter((turnIndex) => turnIndex >= startIndex && turnIndex < endIndex)
    .map((turnIndex) => ({ playerId: draft.sequence[turnIndex], turnIndex }))
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

const scoreForScan = (
  ctx: BoardContext,
  board: Board,
  holdings: Holdings,
  vertexId: VertexId,
  playerId: string,
  modifier: PlacementModifier,
): number => modifier === neutralModifier
  ? fastMarginalTotal(ctx, holdings, vertexId)
  : scoreCandidate(ctx, holdings, vertexId, playerId, board, modifier).total

function bestLegalCandidate(
  ctx: BoardContext,
  board: Board,
  holdings: Holdings,
  blocked: ReadonlySet<VertexId>,
  playerId: string,
  modifier: PlacementModifier,
): VertexId | null {
  let best: VertexId | null = null
  let bestScore = -Infinity
  for (const vertexId of boardGrid(board.layout).vertexIds) {
    if (blocked.has(vertexId)) continue
    const score = scoreForScan(ctx, board, holdings, vertexId, playerId, modifier)
    if (score > bestScore) {
      best = vertexId
      bestScore = score
    }
  }
  return best
}

function opponentPick(
  ctx: BoardContext,
  board: Board,
  playerId: string,
  holdings: Holdings,
  blocked: ReadonlySet<VertexId>,
  uniform: number,
  modifier: PlacementModifier,
): VertexId | null {
  const topVertices: VertexId[] = []
  const topScores: number[] = []
  const topK = Math.max(1, ctx.weights.opponentTopK)
  for (const vertexId of boardGrid(board.layout).vertexIds) {
    if (blocked.has(vertexId)) continue
    const score = scoreForScan(ctx, board, holdings, vertexId, playerId, modifier)
    let index = 0
    while (index < topScores.length && score <= topScores[index]) index += 1
    if (index >= topK) continue
    topVertices.splice(index, 0, vertexId)
    topScores.splice(index, 0, score)
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
  pickerIds: readonly string[],
  initialHoldings: ReadonlyMap<string, Holdings>,
  blocked: Set<VertexId>,
  nextUniform: () => number,
  modifier: PlacementModifier,
): WindowResult {
  const holdings = new Map(initialHoldings)
  const taken: VertexId[] = []
  const actualPickers: string[] = []
  const adjacency = vertexAdjacency(board.layout)
  for (const playerId of pickerIds) {
    const uniform = nextUniform()
    const held = holdings.get(playerId) ?? emptyHoldings()
    const vertexId = opponentPick(ctx, board, playerId, held, blocked, uniform, modifier)
    if (vertexId === null) continue
    blockVertex(adjacency, blocked, vertexId)
    holdings.set(playerId, addToHoldings(ctx, held, vertexId))
    taken.push(vertexId)
    actualPickers.push(playerId)
  }
  return { holdings, pickerIds: actualPickers, taken }
}

/**
 * Exported for tests: exercises defensive branches unreachable from valid boards.
 */
export function simulateOpponentWindow(
  ctx: BoardContext,
  board: Board,
  pickerIds: readonly string[],
  holdings: ReadonlyMap<string, Holdings>,
  blocked: Set<VertexId>,
  nextUniform: () => number,
  modifier: PlacementModifier,
): VertexId[] {
  return simulateWindowDetailed(
    ctx,
    board,
    pickerIds,
    holdings,
    blocked,
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
  // Show the "likely gone" spots from the deterministic (modal) rollout — the
  // greedy scenario where every opponent takes their top choice. Its picks are
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
  const midPickerIds = midTurns.map(({ playerId }) => playerId)
  const candidates = legalSettlementVertices(board)
  const myHoldings = holdingsFromBoard(ctx, board).get(me) ?? emptyHoldings()
  const firstScores = new Map(candidates.map((candidate) => [
    candidate,
    scoreCandidate(ctx, myHoldings, candidate, me, board, options.modifier),
  ]))
  const aggregates = new Map<VertexId, CandidateAggregate>()
  const adjacency = vertexAdjacency(board.layout)

  for (const candidate of candidates) {
    const aggregate: CandidateAggregate = {
      breakdown: emptyBreakdown(),
      expectedTaken: new Map(),
      plannedSecond: new Map(),
      survived: 0,
    }
    const firstScore = firstScores.get(candidate)
    if (!firstScore) continue
    for (const preWindow of preWindows) {
      if (preWindow.blocked.has(candidate)) continue
      aggregate.survived += 1
      addBreakdown(aggregate.breakdown, firstScore.breakdown)
      for (const vertexId of preWindow.taken) {
        aggregate.expectedTaken.set(vertexId, (aggregate.expectedTaken.get(vertexId) ?? 0) + 1)
      }
      if (secondPickIndex === undefined) continue

      const blocked = new Set(preWindow.blocked)
      blockVertex(adjacency, blocked, candidate)
      const firstHoldings = addToHoldings(ctx, myHoldings, candidate)
      const opponentHoldings = replayPreWindowHoldings(ctx, board, draft, preWindow, firstPickIndex)
      let uniformIndex = 0
      const nextUniform = () =>
        preWindow.uniforms?.[midTurns[uniformIndex++]?.turnIndex ?? 0] ?? 0
      const midWindow = simulateWindowDetailed(
        ctx,
        board,
        midPickerIds,
        opponentHoldings,
        blocked,
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
        me,
        options.modifier,
      )
      if (second === null) continue
      const secondScore = scoreCandidate(
        ctx,
        firstHoldings,
        second,
        me,
        board,
        options.modifier,
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
    }
    const survival = aggregate.survived / preWindows.length
    const score = breakdownTotal(breakdown)
    recommendations.push({
      firstPick: candidate,
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
  return {
    recommendations: recommendations.slice(0, options.maxResults),
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
  const baseHoldings = holdingsFromBoard(ctx, board)
  const myHoldings = me === null ? emptyHoldings() : baseHoldings.get(me) ?? emptyHoldings()
  const canRank = !complete && meValid && !meDone && legal.length > 0 && me !== null
  const hasPositiveScore = canRank && legal.some((vertexId) =>
    scoreForScan(ctx, board, myHoldings, vertexId, me, modifier) > 0)
  const shouldRank = canRank && hasPositiveScore
  let recommendations: Recommendation[] = []
  let takenBeforeFirstPick: TakenVertex[] = []

  if (shouldRank && me !== null) {
    const firstPickIndex = draft.myRemainingPickIndices[0]
    const secondPickIndex = draft.myRemainingPickIndices[1]
    const turnIndex = draft.turnIndex ?? firstPickIndex
    const preTurns = remainingTurns(draft, turnIndex, firstPickIndex, me)
    const prePickerIds = preTurns.map(({ playerId }) => playerId)
    const midPicks = secondPickIndex === undefined
      ? 0
      : remainingTurns(draft, firstPickIndex + 1, secondPickIndex, me).length
    const rollouts = options.rollouts ??
      rolloutCount(legal.length, prePickerIds.length, midPicks, weights)
    const random = mulberry32(options.seed ?? 7)
    const uniforms = Array.from({ length: rollouts }, () =>
      Array.from({ length: draft.sequence.length }, () => random()))
    const baseBlocked = blockedVertices(
      board.layout,
      board.buildings.map((building) => building.vertexId),
    )
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
        prePickerIds,
        baseHoldings,
        blocked,
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
