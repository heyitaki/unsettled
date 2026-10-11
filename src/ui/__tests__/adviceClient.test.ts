import { describe, expect, it, vi } from 'vitest'
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
