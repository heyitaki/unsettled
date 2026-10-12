import { afterEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../../model/board'
import { newGame } from '../../../model/game'
import type { AdviceRequest } from '../protocol'
import { createEngine, type Engine } from '../wasm'

vi.mock('../wasm', () => ({ createEngine: vi.fn() }))
const engine = (advise: Engine['advise']): Engine => ({ advise, setupRoad: () => ({ road: null }), analyze: () => ({ error: 'unused' }) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

const request: AdviceRequest = { game: newGame(createBoard('standard4')), observer: 'aki', decision: { kind: 'turn' } }
async function startWorker(fetch: (url: URL) => Promise<Response> = vi.fn(async () => new Response(new Uint8Array([0])))) {
  vi.resetModules()
  const worker = {
    onmessage: null as ((event: MessageEvent<{ id: number; request: AdviceRequest }>) => Promise<void>) | null,
    postMessage: vi.fn(),
  }
  vi.stubGlobal('self', worker)
  vi.stubGlobal('fetch', fetch)
  await import('../advice.worker')
  return { ...worker, fetch, send: (id: number) => worker.onmessage!({ data: { id, request } } as MessageEvent) }
}

it('loads once and returns parsed responses with each request id', async () => {
  const response = { kind: 'turn', actions: [] }
  const advise = vi.fn(() => JSON.stringify(response))
  vi.mocked(createEngine).mockResolvedValue(engine(advise))
  const worker = await startWorker()
  await Promise.all([worker.send(4), worker.send(8)])
  expect(worker.fetch).toHaveBeenCalledOnce()
  expect(String(vi.mocked(worker.fetch).mock.calls[0][0])).toContain('/engine.wasm')
  expect(createEngine).toHaveBeenCalledOnce()
  expect(advise).toHaveBeenCalledWith(JSON.stringify(request))
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 4, response }], [{ id: 8, response }]])
})

it.each(['fetch', 'HTTP', 'instantiate'])('returns a %s load failure for every waiting request', async (stage) => {
  const fetch = vi.fn(async () => {
    if (stage === 'fetch') throw new Error('Offline')
    return new Response(new Uint8Array([0]), { status: stage === 'HTTP' ? 404 : 200 })
  })
  vi.mocked(createEngine).mockRejectedValue(new Error('Invalid wasm'))
  const worker = await startWorker(fetch)
  await Promise.all([worker.send(1), worker.send(2)])
  const error = stage === 'fetch' ? 'Offline' : stage === 'HTTP' ? 'Unable to load the advice engine (404)' : 'Invalid wasm'
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 1, response: { error } }], [{ id: 2, response: { error } }]])
})

it('reports a thrown engine call and answers the next request from a fresh instance', async () => {
  const advise = vi.fn(() => '{"kind":"produce","gains":{}}').mockImplementationOnce(() => { throw new Error('Engine stopped') })
  vi.mocked(createEngine).mockResolvedValue(engine(advise))
  const worker = await startWorker()
  await worker.send(1)
  await worker.send(2)
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 1, response: { error: 'Engine stopped' } }], [{ id: 2, response: { kind: 'produce', gains: {} } }]])
  expect(createEngine).toHaveBeenCalledTimes(2)
})

it.each(['fetch', 'instantiate'])('retries a failed %s load on the next request', async (stage) => {
  const response = { kind: 'produce', gains: {} }
  const fetch = vi.fn(async () => new Response(new Uint8Array([0])))
  vi.mocked(createEngine).mockResolvedValue(engine(() => JSON.stringify(response)))
  if (stage === 'fetch') fetch.mockRejectedValueOnce(new Error('Offline'))
  else vi.mocked(createEngine).mockRejectedValueOnce(new Error('Invalid wasm'))
  const worker = await startWorker(fetch)
  await worker.send(1)
  expect(worker.postMessage.mock.calls[0][0]).toEqual({ id: 1, response: { error: stage === 'fetch' ? 'Offline' : 'Invalid wasm' } })
  await worker.send(2)
  expect(worker.postMessage.mock.calls[1][0]).toEqual({ id: 2, response })
  expect(fetch).toHaveBeenCalledTimes(2)
})
