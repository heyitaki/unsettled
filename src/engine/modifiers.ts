import type { Board, VertexId } from '../model/types'
import type { ScoreBreakdown } from './valuation'
import type { EngineWeights } from './weights'

export interface ModifierContext {
  board: Board
  vertexId: VertexId
  held: readonly VertexId[]
  weights: EngineWeights
}

export type PlacementModifier = (
  playerId: string,
  breakdown: ScoreBreakdown,
  ctx: ModifierContext,
) => ScoreBreakdown

export const neutralModifier: PlacementModifier = (_playerId, breakdown) => breakdown
