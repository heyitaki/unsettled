import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { finishedDraft } from '../../../ui/__tests__/finishedDraft'
import type { AdviceResponse } from '../protocol'
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

it('counts and repeats a finished four-seat draft through the committed wasm', async () => {
  const game = finishedDraft()
  const { board } = game
  const { advise } = await createEngine(readFileSync(new URL('../engine.wasm', import.meta.url)), () => {})
  const request = JSON.stringify({ game, observer: board.players[0].id,
    decision: { kind: 'recap', games: 10, batch: 0 } })
  const first = advise(request)
  const response: AdviceResponse = JSON.parse(first)
  expect(response).toMatchObject({ kind: 'recap', games: 10 })
  if (!('kind' in response) || response.kind !== 'recap') throw new Error(first)
  expect(Object.keys(response.wins).sort()).toEqual(board.players.map(({ id }) => id).sort())
  expect(Object.values(response.wins).reduce((sum, n) => sum + n, response.draws)).toBe(10)
  expect(advise(request)).toBe(first)
}, 30_000)
