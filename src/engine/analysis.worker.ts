import { analyzeBoard, type DraftAnalysis } from './analyze'
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol'

const modalCache = new Map<string, DraftAnalysis>()

self.addEventListener('message', (event: MessageEvent<AnalysisRequest>) => {
  const { id, board, targetPick } = event.data
  let response: AnalysisResponse
  // Each message re-renders the panel, so progress is sent a twentieth at a time.
  let sent = 0
  const onProgress = (progress: number) => {
    if (progress - sent < 0.05) return
    sent = progress
    self.postMessage({ id, progress } satisfies AnalysisResponse)
  }
  try {
    response = { id, analysis: analyzeBoard(board, { targetPick, modalCache, onProgress }) }
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : 'Unable to analyze this board' }
  }
  if (modalCache.size > 300) modalCache.clear()
  self.postMessage(response)
})
