import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AnalysisResult, DraftAnalysis } from '../engine/analysisProtocol'
import { inferDraftState } from '../engine/draft'
import { setMe } from '../model/board'
import type { Board } from '../model/types'
import { analysisCacheVersion, createAnalysisClient } from './analysisClient'
import { viewedPlayerId } from './draftSlots'
import { activeTab, useStore } from './store'
import { AnalysisContext, type AnalysisState } from './useAnalysis'

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { state } = useStore()
  const board = activeTab(state).game.board
  const targetPick = state.viewedPick ?? null
  const playerId = viewedPlayerId(board, targetPick)
  const analysisBoard = useMemo(() => setMe(board, playerId), [board, playerId])
  const [client] = useState(() => createAnalysisClient(
    () => new Worker(new URL('../engine/analysis.worker.ts', import.meta.url), { type: 'module' }),
    // A production chunk's URL and the engine.wasm asset's each carry a
    // content hash, so together they version the saved results. A dev server
    // keeps both URLs while the engine changes under them, so there nothing
    // is saved.
    import.meta.env.PROD ? {
      storage: localStorage,
      version: analysisCacheVersion(import.meta.url, new URL('../engine/advice/engine.wasm', import.meta.url).href),
    } : undefined,
  ))
  const [completed, setCompleted] = useState<{ board: Board; targetPick: number | null; result: AnalysisResult } | null>(null)
  // Tagged like `completed`, so a new view reads as not started without a reset.
  const [progressed, setProgressed] = useState<{ board: Board; targetPick: number | null; fraction: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The last ranking stays in `completed` while the next is pending, so the
  // panel can hold its shape. An error goes: its board can come back (undo, a
  // retry), and must then read as pending rather than as failed again.
  useEffect(() => {
    setCompleted((last) => last && 'error' in last.result ? null : last)
    return client.run(
      analysisBoard,
      (result) => setCompleted({ board: analysisBoard, targetPick, result }),
      targetPick,
      (fraction) => setProgressed({ board: analysisBoard, targetPick, fraction }),
    )
  }, [client, analysisBoard, targetPick, attempt])
  useEffect(() => () => client.dispose(), [client])
  const placeholder = useMemo<DraftAnalysis>(() => {
    const draft = inferDraftState(analysisBoard)
    return { status: 'no-production', draft, warnings: draft.warnings, recommendations: [], takenBeforeFirstPick: [] }
  }, [analysisBoard])
  // A cached result is read during render: waiting for the effect to report it
  // would paint one frame of the pending state between two rankings.
  const cached = useMemo(() => client.peek(analysisBoard, targetPick), [client, analysisBoard, targetPick])
  const result = completed?.board === analysisBoard && completed.targetPick === targetPick ? completed.result
    : cached ? { analysis: cached } : null
  const value: AnalysisState = {
    analysis: result && 'analysis' in result ? result.analysis : placeholder,
    pending: result === null,
    settled: completed && 'analysis' in completed.result ? completed.result.analysis : undefined,
    settledBoard: completed && 'analysis' in completed.result ? completed.board : undefined,
    progress: progressed?.board === analysisBoard && progressed.targetPick === targetPick ? progressed.fraction : 0,
    error: result && 'error' in result ? result.error : null,
    retry: () => setAttempt((value) => value + 1),
  }
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
}
