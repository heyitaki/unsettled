import type { Board } from '../model/types'
import type { DraftAnalysis } from './analyze'

export interface AnalysisRequest {
  id: number
  board: Board
}

export type AnalysisResult = { analysis: DraftAnalysis } | { error: string }
export type AnalysisResponse = AnalysisResult & { id: number }
