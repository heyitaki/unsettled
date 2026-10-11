import type { AnalysisStatus, DraftAnalysis } from '../engine/analyze'
import type { AnalysisRequest, AnalysisResponse, AnalysisResult } from '../engine/analysisProtocol'
import { isRecord } from '../model/serialization'
import type { Board } from '../model/types'
import { ANALYSIS_CACHE_KEY } from '../persistence/localStorage'

export const ANALYSIS_CACHE_SIZE = 50

// With these the engine returns before ranking anything, so the answer costs
// nothing to ask for again and would only push a real ranking out.
const UNRANKED: ReadonlySet<AnalysisStatus> = new Set(['complete', 'no-me', 'me-done'])

// cyrb53. The cache holds this in place of the board's JSON, which was half of
// what it stored. 53 bits: two boards sharing a key, and one showing the
// other's picks, is about a 1 in 10^13 chance for a full cache.
function hash(text: string): string {
  let low = 0xdeadbeef
  let high = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    low = Math.imul(low ^ code, 2654435761)
    high = Math.imul(high ^ code, 1597334677)
  }
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909)
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  return (4294967296 * (2097151 & high) + (low >>> 0)).toString(36)
}

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
  // Keyed by a hash of the board's content rather than its identity, and kept across
  // board changes, so stepping back to a position already analysed costs nothing. A Map
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
  const keyOf = (board: Board, targetPick: number | null) => `${targetPick}|${hash(JSON.stringify(board))}`
  return {
    /** A result already held, read without a worker so a render can show it at once. */
    peek: (board: Board, targetPick: number | null = null): DraftAnalysis | undefined => cache.get(keyOf(board, targetPick)),
    run(board: Board, report: (result: AnalysisResult) => void, targetPick: number | null = null): () => void {
      if (active) stop()
      const key = keyOf(board, targetPick)
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
            if (!UNRANKED.has(event.data.analysis.status)) {
              cache.set(pending.key, event.data.analysis)
              if (cache.size > ANALYSIS_CACHE_SIZE) cache.delete(cache.keys().next().value!)
              if (persist) save(persist, cache)
            }
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
        const request: AnalysisRequest = { id, board, targetPick: targetPick ?? undefined }
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
