import type { AdviceRequest, AdviceResponse } from './protocol'
import { createAdviser } from './wasm'

let adviser: ReturnType<typeof createAdviser> | null = null

function loadAdviser() {
  adviser ??= fetch(new URL('./engine.wasm', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`Unable to load the advice engine (${response.status})`)
    return response.arrayBuffer()
  }).then(createAdviser).catch((error: unknown) => {
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
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage({ id, response })
}
