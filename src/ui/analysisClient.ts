import type { DraftAnalysis } from '../engine/analyze'
import type { AnalysisRequest, AnalysisResponse, AnalysisResult } from '../engine/analysisProtocol'
import type { Board } from '../model/types'

export function createAnalysisClient(factory: () => Worker) {
  const cache = new WeakMap<Board, DraftAnalysis>()
  let worker: Worker | null = null
  let sequence = 0
  let active: { id: number; board: Board; report: (result: AnalysisResult) => void } | null = null
  const stop = () => {
    active = null
    worker?.terminate()
    worker = null
  }
  return {
    run(board: Board, report: (result: AnalysisResult) => void): () => void {
      if (active) stop()
      const cached = cache.get(board)
      if (cached) {
        report({ analysis: cached })
        return () => {}
      }
      const id = ++sequence
      try {
        worker ??= factory()
        active = { id, board, report }
        worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          if (event.data.id !== active?.id) return
          const pending = active
          active = null
          if ('analysis' in event.data) {
            cache.set(pending.board, event.data.analysis)
            pending.report({ analysis: event.data.analysis })
          } else pending.report({ error: event.data.error })
        }
        worker.onerror = (event) => {
          event.preventDefault()
          if (active?.id !== id) return
          const pending = active
          stop()
          pending?.report({ error: event.message || 'Analysis stopped unexpectedly' })
        }
        const request: AnalysisRequest = { id, board }
        worker.postMessage(request)
      } catch (error) {
        stop()
        report({ error: error instanceof Error ? error.message : 'Unable to start analysis' })
      }
      return () => {
        if (active?.id === id) stop()
      }
    },
    dispose: stop,
  }
}
