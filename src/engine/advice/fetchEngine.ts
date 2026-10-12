import { createEngine, type Engine } from './wasm'

/** Fetches the committed engine and loads an independent instance for the caller's thread. */
export async function fetchEngine(progress: (fraction: number) => void): Promise<Engine> {
  const response = await fetch(new URL('./engine.wasm', import.meta.url))
  if (!response.ok) throw new Error(`Unable to load the analysis engine (${response.status})`)
  return createEngine(await response.arrayBuffer(), progress)
}
