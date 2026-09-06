import { createContext, useContext } from 'react'
import type { DraftAnalysis } from '../engine/analyze'

export interface AnalysisState {
  analysis: DraftAnalysis
  pending: boolean
  error: string | null
  retry(): void
}

export const AnalysisContext = createContext<AnalysisState | null>(null)

export function useAnalysis(): AnalysisState {
  const value = useContext(AnalysisContext)
  if (!value) throw new Error('useAnalysis must be used inside AnalysisProvider')
  return value
}
