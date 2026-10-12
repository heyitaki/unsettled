import { afterEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import type { Engine } from '../advice/wasm'
import { mockEngineModule } from './mockEngineModule'

const instantiate = vi.fn<(bytes: BufferSource, imports: WebAssembly.Imports) => Promise<WebAssembly.WebAssemblyInstantiatedSource>>()
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

const board = createBoard('standard4')
const vertexId = boardGrid(board.layout).vertexIds[0]
const road = boardGrid(board.layout).edgeIds[0]

async function start() {
  vi.resetModules()
  const fetch = vi.fn(async () => new Response(new Uint8Array([0])))
  const setupRoad = vi.fn<Engine['setupRoad']>(() => ({ road }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('WebAssembly', { ...WebAssembly, Memory: WebAssembly.Memory, RuntimeError: WebAssembly.RuntimeError, instantiate })
  vi.mocked(instantiate).mockImplementation(async () => mockEngineModule({ advise: () => '', analyze: () => ({ error: 'unused' }), setupRoad }))
  return { fetch, call: (await import('../setupRoad')).setupRoad, setupRoad }
}

it('shares its first load and keeps its own engine for later board taps', async () => {
  const { call, fetch, setupRoad } = await start()
  expect(await Promise.all([call(board, 'aki', vertexId), call(board, 'nobody', vertexId)])).toEqual([road, road])
  expect(await call(board, 'aki', vertexId)).toBe(road)
  expect(fetch).toHaveBeenCalledOnce()
  expect(instantiate).toHaveBeenCalledOnce()
  expect(setupRoad.mock.calls[1]).toEqual([JSON.stringify({ board, playerId: 'nobody', vertexId })])
  setupRoad.mockReturnValueOnce({ road: null })
  expect(await call(board, 'aki', vertexId)).toBeNull()
})

it.each(['fetch', 'HTTP', 'instantiate', 'trap'] as const)('drops the instance after a %s failure and retries', async (stage) => {
  const { call, fetch, setupRoad } = await start()
  if (stage === 'fetch') fetch.mockRejectedValueOnce(new Error('Offline'))
  if (stage === 'HTTP') fetch.mockResolvedValueOnce(new Response('', { status: 404 }))
  if (stage === 'instantiate') vi.mocked(instantiate).mockRejectedValueOnce(new Error('Invalid wasm'))
  if (stage === 'trap') setupRoad.mockImplementationOnce(() => { throw new WebAssembly.RuntimeError('unreachable') })
  await expect(call(board, 'aki', vertexId)).rejects.toThrow()
  expect(await call(board, 'aki', vertexId)).toBe(road)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('surfaces a refused request as an error and keeps the engine', async () => {
  const { call, setupRoad } = await start()
  setupRoad.mockReturnValueOnce({ error: 'Invalid board' })
  await expect(call(board, 'aki', vertexId)).rejects.toThrow('Invalid board')
  expect(await call(board, 'aki', vertexId)).toBe(road)
  expect(instantiate).toHaveBeenCalledOnce()
})
