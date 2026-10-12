import { afterEach, expect, it, vi } from 'vitest'
import { createEngine } from '../wasm'

afterEach(() => vi.unstubAllGlobals())

function moduleWithGrowingMemory() {
  const memory = new WebAssembly.Memory({ initial: 1 })
  const requests: string[] = []
  const dealloc = vi.fn()
  const alloc = vi.fn(() => { memory.grow(1); return 8 })
  const advise = vi.fn((pointer: number, length: number) => {
    requests.push(new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length)))
    const response = memory.buffer.byteLength
    memory.grow(1)
    const bytes = new TextEncoder().encode('{"reason":"木材"}')
    new DataView(memory.buffer).setUint32(response, bytes.length, true)
    new Uint8Array(memory.buffer, response + 4, bytes.length).set(bytes)
    return response
  })
  vi.stubGlobal('WebAssembly', { instantiate: async () => ({ instance: { exports: { memory, alloc, dealloc, advise } } }) })
  return { alloc, advise, dealloc, requests }
}

it('uses fresh memory views after allocations and calls and frees both UTF-8 buffers', async () => {
  const module = moduleWithGrowingMemory()
  const { advise } = await createEngine(new Uint8Array(), () => {})
  for (let call = 0; call < 2; call += 1) {
    expect(advise('{"observer":"赤"}')).toBe('{"reason":"木材"}')
    expect(module.dealloc).toHaveBeenNthCalledWith(call * 2 + 1, (2 + call * 2) * 65536, new TextEncoder().encode('{"reason":"木材"}').length + 4)
    expect(module.dealloc).toHaveBeenNthCalledWith(call * 2 + 2, 8, new TextEncoder().encode('{"observer":"赤"}').length)
  }
  expect(module.requests).toEqual(['{"observer":"赤"}', '{"observer":"赤"}'])
})

it('frees the caller-owned request if the engine throws', async () => {
  const module = moduleWithGrowingMemory()
  module.advise.mockImplementationOnce(() => { throw new Error('Engine stopped') })
  const { advise } = await createEngine(new Uint8Array(), () => {})
  expect(() => advise('{}')).toThrow('Engine stopped')
  expect(module.dealloc.mock.calls).toEqual([[8, 2]])
})
