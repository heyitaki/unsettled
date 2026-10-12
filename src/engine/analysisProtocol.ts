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
  road: EdgeId | null
  frequency: number
}

export interface Recommendation {
  firstPick: VertexId
  /**
   * The second settlements planned behind this pick: first the one from the rollout the row's
   * road and the likely-gone line are read off, then the rest by how often they were planned.
   */
  plannedSecond: VertexId[]
  /**
   * The setup road SP3's expansion walk would lay from `firstPick`, or null when the walk is off
   * (`expansionWeight` 0) or the pick opens nothing.
   */
  firstRoad: EdgeId | null
  /** The setup road for `plannedSecond[0]`, read off the same rollout. */
  secondRoad: EdgeId | null
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
