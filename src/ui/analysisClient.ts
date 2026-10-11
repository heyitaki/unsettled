import type { DraftAnalysis } from '../engine/analyze'
import type { AnalysisRequest, AnalysisResponse, AnalysisResult } from '../engine/analysisProtocol'
import { isRecord } from '../model/serialization'
import type { Board } from '../model/types'
import { ANALYSIS_CACHE_KEY } from '../persistence/localStorage'

export const ANALYSIS_CACHE_SIZE = 50

// `version` must change whenever the analysis code does: entries saved under
// another version are dropped unread, which is also the only shape check.
export interface AnalysisCachePersistence {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  version: string
}

function restore({ storage, version }: AnalysisCachePersistence): Map<string, DraftAnalysis> {
  try {
    const saved: unknown = JSON.parse(storage.getItem(ANALYSIS_CACHE_KEY) ?? 'null')
    if (isRecord(saved) && saved.version === version) return new Map(saved.entries as [string, DraftAnalysis][])
  } catch { /* an unreadable cache is an empty one */ }
  return new Map()
}

function save({ storage, version }: AnalysisCachePersistence, cache: Map<string, DraftAnalysis>) {
  try {
    storage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify({ version, entries: [...cache] }))
  } catch {
    // Too full for the cache: give its space back to the saved games.
    try { storage.removeItem(ANALYSIS_CACHE_KEY) } catch { /* storage is blocked outright */ }
  }
}

export function createAnalysisClient(factory: () => Worker, persist?: AnalysisCachePersistence) {
  // Keyed by board content rather than identity, and kept across board changes,
  // so stepping back to a position already analysed costs nothing. A Map
  // iterates in insertion order, which makes it the recency list too.
  const cache = persist ? restore(persist) : new Map<string, DraftAnalysis>()
  let worker: Worker | null = null
  let sequence = 0
  let active: { id: number; key: string; report: (result: AnalysisResult) => void } | null = null
  const stop = () => {
    active = null
    worker?.terminate()
    worker = null
  }
  return {
    run(board: Board, report: (result: AnalysisResult) => void): () => void {
      if (active) stop()
      const key = JSON.stringify(board)
      const cached = cache.get(key)
      if (cached) {
        cache.delete(key)
        cache.set(key, cached)
        report({ analysis: cached })
        return () => {}
      }
      const id = ++sequence
      try {
        worker ??= factory()
        active = { id, key, report }
        worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          if (event.data.id !== active?.id) return
          const pending = active
          active = null
          if ('analysis' in event.data) {
            cache.set(pending.key, event.data.analysis)
            if (cache.size > ANALYSIS_CACHE_SIZE) cache.delete(cache.keys().next().value!)
            if (persist) save(persist, cache)
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
