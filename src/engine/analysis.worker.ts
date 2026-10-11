import { analyzeBoard, type DraftAnalysis } from './analyze'
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol'

const modalCache = new Map<string, DraftAnalysis>()

self.addEventListener('message', (event: MessageEvent<AnalysisRequest>) => {
  const { id, board, targetPick } = event.data
  let response: AnalysisResponse
  try {
    response = { id, analysis: analyzeBoard(board, { targetPick, modalCache }) }
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : 'Unable to analyze this board' }
  }
  if (modalCache.size > 300) modalCache.clear()
  self.postMessage(response)
})
