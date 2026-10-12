import { createContext, useContext } from 'react'
import type { DraftAnalysis } from '../engine/analysisProtocol'

export interface AnalysisState {
  analysis: DraftAnalysis
  pending: boolean
  /** The last ranking to arrive, for any board: the pending state keeps its shape. */
  settled?: DraftAnalysis
  /** How much of the pending ranking is done, from 0 to 1. */
  progress?: number
  error: string | null
  retry(): void
}

export const AnalysisContext = createContext<AnalysisState | null>(null)

export function useAnalysis(): AnalysisState {
  const value = useContext(AnalysisContext)
  if (!value) throw new Error('useAnalysis must be used inside AnalysisProvider')
  return value
}
