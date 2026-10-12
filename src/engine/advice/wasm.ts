import type { EdgeId } from '../../model/types'
import type { DraftAnalysis } from '../analysisProtocol'

export interface Engine {
  setupRoad(request: string): { road: EdgeId | null } | { error: string }
  advise(request: string): string
  analyze(request: string): DraftAnalysis | { error: string }
}

/** The response fields the Rust `js_number` writes: a non-finite one travels as a string. */
const NUMBER_FIELDS = new Set([
  'survival', 'score', 'rankScore', 'frequency',
  'production', 'scarcity', 'robber', 'diversity', 'port', 'handValue', 'expansion',
])
const NON_FINITE = new Map([['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]])

/** `JSON.parse` reviver for analysis responses, keyed by field so a player id of "NaN" stays text. */
export function reviveNonFinite(key: string, value: unknown): unknown {
  return typeof value === 'string' && NUMBER_FIELDS.has(key) ? NON_FINITE.get(value) ?? value : value
}

/** The one loader. `progress` receives the fraction done so far of a running `analyze` call. */
export async function createEngine(bytes: BufferSource, progress: (fraction: number) => void): Promise<Engine> {
  const { instance } = await WebAssembly.instantiate(bytes, { env: { progress } })
  const { memory, alloc, dealloc, advise, analyze, setup_road } = instance.exports as {
    memory: WebAssembly.Memory
    alloc(length: number): number
    dealloc(pointer: number, length: number): void
    advise(pointer: number, length: number): number
    analyze(pointer: number, length: number): number
    setup_road(pointer: number, length: number): number
  }
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // All entries take and return their JSON the same way.
  const call = (entry: (pointer: number, length: number) => number) => (request: string) => {
    const input = encoder.encode(request)
    const pointer = alloc(input.length)
    let response: number | undefined
    let length = 0
    try {
      new Uint8Array(memory.buffer, pointer, input.length).set(input)
      response = entry(pointer, input.length)
      length = new DataView(memory.buffer).getUint32(response, true)
      return decoder.decode(new Uint8Array(memory.buffer, response + 4, length))
    } finally {
      if (response !== undefined) dealloc(response, length + 4)
      dealloc(pointer, input.length)
    }
  }
  const analyzeText = call(analyze)
  const setupRoadText = call(setup_road)
  return {
    advise: call(advise),
    analyze: (request) => JSON.parse(analyzeText(request), reviveNonFinite),
    setupRoad: (request) => JSON.parse(setupRoadText(request)),
  }
}
