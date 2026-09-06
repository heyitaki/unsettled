import { analyzeBoard } from './analyze'
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol'

self.addEventListener('message', (event: MessageEvent<AnalysisRequest>) => {
  const { id, board } = event.data
  let response: AnalysisResponse
  try {
    response = { id, analysis: analyzeBoard(board) }
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : 'Unable to analyze this board' }
  }
  self.postMessage(response)
})
