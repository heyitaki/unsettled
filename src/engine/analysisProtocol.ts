import type { Board } from '../model/types'
import type { DraftAnalysis } from './analyze'

export interface AnalysisRequest {
  id: number
  board: Board
  targetPick?: number
}

export type AnalysisResult = { analysis: DraftAnalysis } | { error: string }
/** `progress` is the fraction of the job done so far; any number of them precede the one result. */
export type AnalysisResponse = (AnalysisResult | { progress: number }) & { id: number }
