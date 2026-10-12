import { afterEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { createEngine } from '../advice/wasm'
import type { AnalysisRequest, DraftAnalysis } from '../analysisProtocol'
import { inferDraftState } from '../draft'

vi.mock('../advice/wasm', () => ({ createEngine: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

const board = createBoard('standard4')
const analysis: DraftAnalysis = {
  status: 'no-production', draft: inferDraftState(board), warnings: [], recommendations: [], takenBeforeFirstPick: [],
}

/** Stands in for the engine: `analyze` reports each of `fractions` through the progress import, then answers. */
function engine(analyze = vi.fn((_request: string): DraftAnalysis | { error: string } => analysis), fractions: number[] = []) {
  vi.mocked(createEngine).mockImplementation(async (_bytes, progress) => ({
    advise: () => '',
    setupRoad: () => ({ road: null }),
    analyze: (request) => {
      fractions.forEach(progress)
      return analyze(request)
    },
  }))
  return analyze
}

async function startWorker(fetch: (url: URL) => Promise<Response> = vi.fn(async () => new Response(new Uint8Array([0])))) {
  vi.resetModules()
  const worker = {
    onmessage: null as ((event: MessageEvent<AnalysisRequest>) => Promise<void>) | null,
    postMessage: vi.fn(),
  }
  vi.stubGlobal('self', worker)
  vi.stubGlobal('fetch', fetch)
  await import('../analysis.worker')
  return {
    ...worker,
    fetch,
    send: (id: number, targetPick?: number) => worker.onmessage!({ data: { id, board, targetPick } } as MessageEvent),
  }
}

it('loads once and returns each analysis with its request id', async () => {
  const analyze = engine()
  const worker = await startWorker()
  await Promise.all([worker.send(4), worker.send(8, 3)])
  expect(worker.fetch).toHaveBeenCalledOnce()
  expect(String(vi.mocked(worker.fetch).mock.calls[0][0])).toContain('/advice/engine.wasm')
  expect(createEngine).toHaveBeenCalledOnce()
  expect(analyze.mock.calls).toEqual([[JSON.stringify({ board })], [JSON.stringify({ board, targetPick: 3 })]])
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 4, analysis }], [{ id: 8, analysis }]])
})

it('forwards progress a twentieth at a time, starting over for each request', async () => {
  engine(undefined, [0.02, 0.06, 0.1, 0.2, 1])
  const worker = await startWorker()
  await worker.send(1)
  await worker.send(2)
  const sent = (id: number) => [[{ id, progress: 0.06 }], [{ id, progress: 0.2 }], [{ id, progress: 1 }], [{ id, analysis }]]
  expect(worker.postMessage.mock.calls).toEqual([...sent(1), ...sent(2)])
})

it('returns the error of a request the engine refuses', async () => {
  engine(vi.fn(() => ({ error: 'Board has no players' })))
  const worker = await startWorker()
  await worker.send(1)
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 1, error: 'Board has no players' }]])
})

it('reports a thrown engine call and answers the next request from a fresh instance', async () => {
  engine(vi.fn((_request: string): DraftAnalysis => analysis).mockImplementationOnce(() => { throw new Error('unreachable') }))
  const worker = await startWorker()
  await worker.send(1)
  await worker.send(2)
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 1, error: 'unreachable' }], [{ id: 2, analysis }]])
  expect(createEngine).toHaveBeenCalledTimes(2)
})

it.each(['fetch', 'HTTP', 'instantiate'])('returns a %s load failure for every waiting request', async (stage) => {
  const fetch = vi.fn(async () => {
    if (stage === 'fetch') throw new Error('Offline')
    return new Response(new Uint8Array([0]), { status: stage === 'HTTP' ? 404 : 200 })
  })
  vi.mocked(createEngine).mockRejectedValue(new Error('Invalid wasm'))
  const worker = await startWorker(fetch)
  await Promise.all([worker.send(1), worker.send(2)])
  const error = stage === 'fetch' ? 'Offline' : stage === 'HTTP' ? 'Unable to load the analysis engine (404)' : 'Invalid wasm'
  expect(worker.postMessage.mock.calls).toEqual([[{ id: 1, error }], [{ id: 2, error }]])
})

it.each(['fetch', 'instantiate'])('retries a failed %s load on the next request', async (stage) => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([0])))
  engine()
  if (stage === 'fetch') fetch.mockRejectedValueOnce(new Error('Offline'))
  else vi.mocked(createEngine).mockRejectedValueOnce(new Error('Invalid wasm'))
  const worker = await startWorker(fetch)
  await worker.send(1)
  expect(worker.postMessage.mock.calls[0][0]).toEqual({ id: 1, error: stage === 'fetch' ? 'Offline' : 'Invalid wasm' })
  await worker.send(2)
  expect(worker.postMessage.mock.calls[1][0]).toEqual({ id: 2, analysis })
  expect(fetch).toHaveBeenCalledTimes(2)
})
