import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse } from '../../engine/advice/protocol'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { createAdviceClient } from '../adviceClient'

function harness() {
  const workers: {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    onmessage: Worker['onmessage']
    onerror: Worker['onerror']
    onmessageerror: Worker['onmessageerror']
  }[] = []
  const client = createAdviceClient(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }
    workers.push(worker)
    return worker as unknown as Worker
  })
  const reply = (index: number, id: number, response: AdviceResponse) => {
    const worker = workers[index]
    worker.onmessage?.call(worker as unknown as Worker, { data: { id, response } } as MessageEvent)
  }
  return { client, workers, reply }
}

const request: AdviceRequest = { game: newGame(createBoard('standard4')), observer: 'aki', decision: { kind: 'produce', total: 8 } }
const response: AdviceResponse = { kind: 'produce', gains: { aki: { wood: 1, sheep: 0, wheat: 2, brick: 0, ore: 0 } } }

afterEach(() => vi.unstubAllGlobals())

const recapRequest = (batch: number): AdviceRequest => ({
  ...request, decision: { kind: 'recap', games: 50, batch },
})
const recapResponse: AdviceResponse = { kind: 'recap', games: 50, wins: { aki: 45 }, draws: 5 }

describe('recap worker pool', () => {
  it.each([[undefined, 1], [0, 1], [1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [16, 4]])(
    'reads hardware concurrency %s once and exposes %s recap workers', (cores, expected) => {
      const hardwareConcurrency = vi.fn(() => cores)
      vi.stubGlobal('navigator', { get hardwareConcurrency() { return hardwareConcurrency() } })
      const { client, workers } = harness()
      expect(client.recapWorkers).toBe(expected)
      expect(workers).toHaveLength(0)
      hardwareConcurrency.mockReturnValue(32)
      void client.request(recapRequest(0))
      void client.request(recapRequest(1))
      expect(client.recapWorkers).toBe(expected)
      expect(hardwareConcurrency).toHaveBeenCalledOnce()
      client.dispose()
    },
  )

  it('keeps the batches on the main worker when there is one recap worker', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 })
    const { client, workers, reply } = harness()
    for (let batch = 0; batch < 20; batch += 1) {
      const answer = client.request(recapRequest(batch))
      reply(0, batch + 1, recapResponse)
      expect(await answer).toEqual(recapResponse)
    }
    expect(workers).toHaveLength(1)
    expect(workers[0].terminate).not.toHaveBeenCalled()
    client.dispose()
  })

  it.each([2, 3, 4])('routes all 20 batches by modulo across %i recap workers beside the main worker', (count) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: count + 1 })
    const { client, workers } = harness()
    void client.request(request)
    for (let batch = 0; batch < 20; batch += 1) {
      void client.request(recapRequest(batch))
      expect(workers).toHaveLength(1 + Math.min(count, batch + 1))
      expect(workers[1 + batch % count].postMessage).toHaveBeenLastCalledWith({ id: batch + 2, request: recapRequest(batch) })
    }
    expect(workers[0].postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, request })
    client.dispose()
  })

  it('terminates only the recap workers after the last answer and serves a second run from cache', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 5 })
    const { client, workers, reply } = harness()
    const main = client.request(request)
    const batches = Array.from({ length: 20 }, (_, batch) => client.request(recapRequest(batch)))
    for (let batch = 19; batch > 0; batch -= 1) reply(1 + batch % 4, batch + 2, recapResponse)
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true)
    reply(1, 2, recapResponse)
    expect(await Promise.all(batches)).toEqual(Array(20).fill(recapResponse))
    for (const worker of workers.slice(1)) expect(worker.terminate).toHaveBeenCalledOnce()
    expect(workers[0].terminate).not.toHaveBeenCalled()
    const cached = Promise.all(Array.from({ length: 20 }, (_, batch) => client.request(recapRequest(batch))))
    expect(workers).toHaveLength(5)
    expect(workers.slice(1).map((worker) => worker.postMessage.mock.calls.length)).toEqual([5, 5, 5, 5])
    expect(await cached).toEqual(Array(20).fill(recapResponse))
    reply(0, 1, response)
    expect(await main).toEqual(response)
    client.dispose()
  })

  it.each(['onerror', 'onmessageerror'] as const)('fails every worker pending request on %s', async (event) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 5 })
    const { client, workers, reply } = harness()
    const reports = Array.from({ length: 5 }, () => vi.fn())
    void client.request(request).then(reports[0])
    for (let batch = 0; batch < 4; batch += 1) void client.request(recapRequest(batch)).then(reports[batch + 1])
    const failed = workers[2]
    if (event === 'onerror') {
      failed.onerror?.call(failed as unknown as Worker, { message: 'Failed', preventDefault() {} } as ErrorEvent)
    } else {
      failed.onmessageerror?.call(failed as unknown as Worker, {} as MessageEvent)
    }
    await Promise.resolve()
    for (const report of reports) expect(report).toHaveBeenCalledExactlyOnceWith({
      error: event === 'onerror' ? 'Failed' : 'Unable to read advice',
    })
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce()
    const retry = client.request(recapRequest(0))
    reply(5, 6, recapResponse)
    expect(await retry).toEqual(recapResponse)
    client.dispose()
  })

  it.each(['cancelAll', 'dispose'] as const)('%s terminates the whole pool and ignores old replies and errors', async (stop) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 5 })
    const { client, workers, reply } = harness()
    const stale = vi.fn()
    void client.request(request).then(stale)
    for (let batch = 0; batch < 4; batch += 1) void client.request(recapRequest(batch)).then(stale)
    client[stop]()
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce()
    const next = vi.fn()
    void client.request(recapRequest(0)).then(next)
    reply(1, 2, recapResponse)
    workers[1].onerror?.call(workers[1] as unknown as Worker, { message: 'Late', preventDefault() {} } as ErrorEvent)
    workers[1].onmessageerror?.call(workers[1] as unknown as Worker, {} as MessageEvent)
    await Promise.resolve()
    expect(stale).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    reply(5, 6, recapResponse)
    await Promise.resolve()
    expect(next).toHaveBeenCalledExactlyOnceWith(recapResponse)
    client.dispose()
  })
})

describe('advice client', () => {
  it("answers a request with the worker's response", async () => {
    const { client, workers, reply } = harness()
    const answer = client.request(request)
    expect(workers[0].postMessage).toHaveBeenCalledWith({ id: 1, request })
    reply(0, 1, response)
    expect(await answer).toEqual(response)
  })

  it('ignores a reply for an unknown id', async () => {
    const { client, reply } = harness()
    const report = vi.fn()
    const answer = client.request(request).then(report)
    reply(0, 99, response)
    await Promise.resolve()
    expect(report).not.toHaveBeenCalled()
    reply(0, 1, response)
    await answer
    expect(report).toHaveBeenCalledWith(response)
  })

  it('serves a repeated request from the cache without posting', async () => {
    const { client, workers, reply } = harness()
    const answer = client.request(request)
    reply(0, 1, response)
    await answer
    expect(await client.request({ ...request, decision: { total: 8, kind: 'produce' } })).toEqual(response)
    expect(workers[0].postMessage).toHaveBeenCalledOnce()
  })

  it('keeps several requests in flight at once', async () => {
    const { client, workers, reply } = harness()
    const first = client.request(request)
    const second = client.request({ ...request, observer: 'b', decision: { kind: 'discard' } })
    const error = { error: 'No known cards' }
    reply(0, 2, error)
    reply(0, 1, response)
    expect(await first).toEqual(response)
    expect(await second).toEqual(error)
    expect(workers).toHaveLength(1)
  })

  it('cancelAll terminates the worker and the next request starts a new one', async () => {
    const { client, workers, reply } = harness()
    const stale = vi.fn()
    void client.request(request).then(stale)
    client.cancelAll()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    const next = client.request(request)
    reply(0, 1, response)
    await Promise.resolve()
    expect(stale).not.toHaveBeenCalled()
    expect(workers).toHaveLength(2)
    reply(1, 2, response)
    expect(await next).toEqual(response)
  })

  it('does not cache errors so retry posts again', async () => {
    const { client, workers, reply } = harness()
    const answer = client.request(request)
    reply(0, 1, { error: 'Unavailable' })
    await answer
    const retry = client.request(request)
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2)
    reply(0, 2, response)
    expect(await retry).toEqual(response)
  })

  it('reports worker failures to every pending request and restarts', async () => {
    const { client, workers, reply } = harness()
    const first = client.request(request)
    const second = client.request({ ...request, observer: 'b' })
    workers[0].onerror?.call(workers[0] as unknown as Worker, { message: 'Failed', preventDefault() {} } as ErrorEvent)
    expect(await first).toEqual({ error: 'Failed' })
    expect(await second).toEqual({ error: 'Failed' })
    const retry = client.request(request)
    reply(1, 3, response)
    expect(await retry).toEqual(response)
  })

  it('ignores an error from a terminated worker', async () => {
    const { client, workers, reply } = harness()
    void client.request(request)
    const oldError = workers[0].onerror
    client.cancelAll()
    const answer = client.request(request)
    oldError?.call(workers[0] as unknown as Worker, { message: 'Late failure', preventDefault() {} } as ErrorEvent)
    reply(1, 2, response)
    expect(await answer).toEqual(response)
  })

  it('keys the cache by game identity, observer and all decision fields', async () => {
    const { client, workers, reply } = harness()
    const initial = client.request(request)
    reply(0, 1, response)
    await initial
    const variants: AdviceRequest[] = [
      { ...request, game: { ...request.game } },
      { ...request, observer: 'b' },
      { ...request, decision: { kind: 'produce', total: 6 } },
      { ...request, decision: { kind: 'tradeResponse', proposer: 'b', give: 'wood', get: 'ore', count: 1 } },
      { ...request, decision: { kind: 'tradeResponse', proposer: 'b', give: 'wood', get: 'ore', count: 2 } },
    ]
    variants.push(
      { ...request, decision: { kind: 'tradeResponse', proposer: 'c', give: 'wood', get: 'ore', count: 1 } },
      { ...request, decision: { kind: 'tradeResponse', proposer: 'b', give: 'brick', get: 'ore', count: 1 } },
      { ...request, decision: { kind: 'tradeResponse', proposer: 'b', give: 'wood', get: 'wheat', count: 1 } },
    )
    for (const [index, variant] of variants.entries()) {
      const answer = client.request(variant)
      expect(workers[0].postMessage).toHaveBeenCalledTimes(index + 2)
      reply(0, index + 2, response)
      expect(await answer).toEqual(response)
      expect(await client.request(variant)).toEqual(response)
      expect(workers[0].postMessage).toHaveBeenCalledTimes(index + 2)
    }
  })

  it('returns a startup failure as advice error and permits retry', async () => {
    const client = createAdviceClient(() => { throw new Error('Unavailable') })
    expect(await client.request(request)).toEqual({ error: 'Unavailable' })
    expect(await client.request(request)).toEqual({ error: 'Unavailable' })
  })
})
