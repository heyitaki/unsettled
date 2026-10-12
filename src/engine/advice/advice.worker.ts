import type { AdviceRequest, AdviceResponse } from './protocol'
import { createEngine, type Engine } from './wasm'

let adviser: Promise<Engine['advise']> | null = null

function loadAdviser() {
  adviser ??= fetch(new URL('./engine.wasm', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`Unable to load the advice engine (${response.status})`)
    return response.arrayBuffer()
  }).then(async (bytes) => (await createEngine(bytes, () => {})).advise).catch((error: unknown) => {
    adviser = null
    throw error
  })
  return adviser
}

self.onmessage = async (event: MessageEvent<{ id: number; request: AdviceRequest }>) => {
  const { id, request } = event.data
  let response: AdviceResponse
  try {
    const advise = await loadAdviser()
    response = JSON.parse(advise(JSON.stringify(request)))
  } catch (error) {
    // A trap leaves the instance's state half-written, so the next request loads a fresh one.
    adviser = null
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage({ id, response })
}
