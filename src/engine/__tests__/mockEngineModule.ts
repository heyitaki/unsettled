import type { Engine } from '../advice/wasm'

/** Runs the real wasm loader against a small JSON-speaking module. */
export function mockEngineModule(engine: Engine): WebAssembly.WebAssemblyInstantiatedSource {
  const memory = new WebAssembly.Memory({ initial: 1 })
  const entry = (call: (request: string) => string) => (pointer: number, length: number) => {
    const request = new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length))
    const response = new TextEncoder().encode(call(request))
    const result = 32768
    new DataView(memory.buffer).setUint32(result, response.length, true)
    new Uint8Array(memory.buffer, result + 4, response.length).set(response)
    return result
  }
  return {
    module: {} as WebAssembly.Module,
    instance: { exports: {
      memory, alloc: () => 0, dealloc: () => {},
      advise: entry(engine.advise),
      analyze: entry((request) => JSON.stringify(engine.analyze(request))),
      setup_road: entry((request) => JSON.stringify(engine.setupRoad(request))),
    } } as unknown as WebAssembly.Instance,
  }
}
