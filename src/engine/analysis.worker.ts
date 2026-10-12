import { createEngine, type Engine } from './advice/wasm'
import type { AnalysisRequest, AnalysisResponse } from './analysisProtocol'

let engine: Promise<Engine> | null = null
// Where the engine's progress import reports to: the request being analysed.
let onProgress: (fraction: number) => void = () => {}

function loadEngine() {
  engine ??= fetch(new URL('./advice/engine.wasm', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`Unable to load the analysis engine (${response.status})`)
    return response.arrayBuffer()
  }).then((bytes) => createEngine(bytes, (fraction) => onProgress(fraction))).catch((error: unknown) => {
    engine = null
    throw error
  })
  return engine
}

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, board, targetPick } = event.data
  let response: AnalysisResponse
  try {
    const { analyze } = await loadEngine()
    // Each message re-renders the panel, so progress is sent a twentieth at a time.
    let sent = 0
    onProgress = (progress) => {
      if (progress - sent < 0.05) return
      sent = progress
      self.postMessage({ id, progress } satisfies AnalysisResponse)
    }
    // The call does not yield, so no other request can take `onProgress` while it runs.
    const result = analyze(JSON.stringify({ board, targetPick }))
    response = 'error' in result ? { id, error: result.error } : { id, analysis: result }
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : 'Unable to analyze this board' }
  }
  self.postMessage(response)
}
