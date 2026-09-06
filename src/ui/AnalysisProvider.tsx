import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DraftAnalysis } from '../engine/analyze'
import type { AnalysisResult } from '../engine/analysisProtocol'
import { inferDraftState } from '../engine/draft'
import type { Board } from '../model/types'
import { createAnalysisClient } from './analysisClient'
import { activeTab, useStore } from './store'
import { AnalysisContext, type AnalysisState } from './useAnalysis'

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { state } = useStore()
  const board = activeTab(state).game.board
  const [client] = useState(() => createAnalysisClient(() =>
    new Worker(new URL('../engine/analysis.worker.ts', import.meta.url), { type: 'module' })))
  const [completed, setCompleted] = useState<{ board: Board; result: AnalysisResult } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setCompleted(null)
    return client.run(board, (result) => setCompleted({ board, result }))
  }, [client, board, attempt])
  useEffect(() => () => client.dispose(), [client])
  const placeholder = useMemo<DraftAnalysis>(() => {
    const draft = inferDraftState(board)
    return { status: 'no-production', draft, warnings: draft.warnings, recommendations: [], takenBeforeFirstPick: [] }
  }, [board])
  const result = completed?.board === board ? completed.result : null
  const value: AnalysisState = {
    analysis: result && 'analysis' in result ? result.analysis : placeholder,
    pending: result === null,
    error: result && 'error' in result ? result.error : null,
    retry: () => setAttempt((value) => value + 1),
  }
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
}
