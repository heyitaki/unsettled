import type { Board, EdgeId, VertexId } from '../model/types'
import type { DraftState, DraftWarning } from './draft'

// The result types mirror the JSON that `simulator/crates/engine/src/placement/analysis.rs` writes.

export interface ScoreBreakdown {
  production: number
  scarcity: number
  /** The robbed-hex discount, plus the concentration delta. */
  robber: number
  diversity: number
  port: number
  handValue: number
  /** What the sites this vertex opens are worth. */
  expansion: number
}

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
   * The setup road the expansion walk would lay from `firstPick`, or null when the walk is off
   * (`expansionWeight` 0) or the pick opens nothing.
   */
  firstRoad: EdgeId | null
  survival: number
  score: number
  rankScore: number
  breakdown: ScoreBreakdown
}

export interface DraftAnalysis {
  status: AnalysisStatus
  draft: DraftState
  recommendations: Recommendation[]
  takenBeforeFirstPick: TakenVertex[]
  warnings: DraftWarning[]
}

export interface AnalysisRequest {
  id: number
  board: Board
  targetPick?: number
}

export type AnalysisResult = { analysis: DraftAnalysis } | { error: string }
/** `progress` is the fraction of the job done so far; any number of them precede the one result. */
export type AnalysisResponse = (AnalysisResult | { progress: number }) & { id: number }
