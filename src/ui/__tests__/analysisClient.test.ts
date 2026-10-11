import { describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import type { DraftAnalysis } from '../../engine/analyze'
import { inferDraftState } from '../../engine/draft'
import { ANALYSIS_CACHE_KEY } from '../../persistence/localStorage'
import { ANALYSIS_CACHE_SIZE, createAnalysisClient, type AnalysisCachePersistence } from '../analysisClient'

function harness(persist?: AnalysisCachePersistence) {
  const workers: {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    onmessage: Worker['onmessage']
    onerror: Worker['onerror']
  }[] = []
  const client = createAnalysisClient(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
    workers.push(worker)
    return worker as unknown as Worker
  }, persist)
  const reply = (index: number, analysis: DraftAnalysis) => {
    const worker = workers[index]
    const request = worker.postMessage.mock.calls.at(-1)?.[0]
    worker.onmessage?.call(worker as unknown as Worker, { data: { id: request.id, analysis } } as MessageEvent)
  }
  return { client, workers, reply }
}

const board = createBoard('standard4')
const analysis: DraftAnalysis = {
  status: 'no-production', draft: inferDraftState(board), recommendations: [], takenBeforeFirstPick: [], warnings: [],
}

describe('analysis client', () => {
  it('cancels obsolete computation and ignores a late response for a different board', () => {
    const { client, workers, reply } = harness()
    const first = vi.fn()
    const second = vi.fn()
    client.run(board, first)
    client.run(createBoard('extension6'), second)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    reply(0, analysis)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    reply(1, analysis)
    expect(second).toHaveBeenCalledWith({ analysis })
    client.dispose()
  })

  it('reuses completed results when returning to a board, without starting more computation', () => {
    const { client, workers, reply } = harness()
    client.run(board, vi.fn())
    reply(0, analysis)
    const report = vi.fn()
    client.run(board, report)
    expect(report).toHaveBeenCalledWith({ analysis })
    expect(workers[0].postMessage).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('reuses a result for a different board object with the same content', () => {
    const { client, workers, reply } = harness()
    client.run(board, vi.fn())
    reply(0, analysis)
    const report = vi.fn()
    client.run(createBoard('standard4'), report)
    expect(report).toHaveBeenCalledWith({ analysis })
    expect(workers[0].postMessage).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('does not keep a result the engine never had to rank for', () => {
    const { client, workers, reply } = harness()
    for (const status of ['complete', 'no-me', 'me-done'] as const) {
      const unranked = { ...board, mePlayerId: status }
      client.run(unranked, vi.fn())
      reply(0, { ...analysis, status })
      const before = workers[0].postMessage.mock.calls.length
      client.run(unranked, vi.fn())
      expect(workers[0].postMessage.mock.calls.length).toBe(before + 1)
      reply(0, { ...analysis, status })
    }
    client.dispose()
  })

  it('gives boards that differ anywhere their own result', () => {
    const { client, workers, reply } = harness()
    const variants = [
      { ...board, robber: { q: 1, r: -1 } },
      { ...board, robber: { q: -1, r: 1 } },
      { ...board, mePlayerId: 'p1' },
      { ...board, mePlayerId: 'p2' },
      { ...board, hexes: board.hexes.toReversed() },
      { ...board, players: board.players.toReversed() },
    ]
    for (const [index, variant] of variants.entries()) {
      client.run(variant, vi.fn())
      expect(workers[0].postMessage.mock.calls.length).toBe(index + 1)
      reply(0, analysis)
    }
    client.dispose()
  })

  it('evicts the least recently used result once the cache is full', () => {
    const { client, workers, reply } = harness()
    const variant = (index: number) => ({ ...board, mePlayerId: `p${index}` })
    const posts = () => workers[0].postMessage.mock.calls.length
    const compute = (index: number) => {
      client.run(variant(index), vi.fn())
      reply(0, analysis)
    }
    for (let index = 0; index < ANALYSIS_CACHE_SIZE; index++) compute(index)
    client.run(variant(0), vi.fn())
    expect(posts()).toBe(ANALYSIS_CACHE_SIZE)
    compute(ANALYSIS_CACHE_SIZE)
    client.run(variant(0), vi.fn())
    expect(posts()).toBe(ANALYSIS_CACHE_SIZE + 1)
    client.run(variant(1), vi.fn())
    expect(posts()).toBe(ANALYSIS_CACHE_SIZE + 2)
    client.dispose()
  })

  it('restores results saved by an earlier client of the same version, and none from another', () => {
    const stored = new Map<string, string>()
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    }
    const first = harness({ storage, version: 'a' })
    first.client.run(board, vi.fn())
    first.reply(0, analysis)
    first.client.dispose()
    expect(stored.get(ANALYSIS_CACHE_KEY)).not.toContain('hexes')

    const same = harness({ storage, version: 'a' })
    const report = vi.fn()
    same.client.run(createBoard('standard4'), report)
    expect(report).toHaveBeenCalledWith({ analysis })
    expect(same.workers).toHaveLength(0)

    const other = harness({ storage, version: 'b' })
    other.client.run(board, vi.fn())
    expect(other.workers[0].postMessage).toHaveBeenCalledOnce()
    other.client.dispose()
  })

  it.each(['{not json', '{"version":"a","entries":[null]}', '{"version":"a","entries":5}'])(
    'starts empty from a stored value it cannot use: %s', (saved) => {
      const { client, workers } = harness({
        storage: { getItem: () => saved, setItem: () => {}, removeItem: () => {} },
        version: 'a',
      })
      client.run(board, vi.fn())
      expect(workers[0].postMessage).toHaveBeenCalledOnce()
      client.dispose()
    })

  it('still reports when the store refuses the write, and frees its own entry', () => {
    const removeItem = vi.fn(() => { throw new Error('SecurityError') })
    const { client, reply } = harness({
      storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem },
      version: 'a',
    })
    const report = vi.fn()
    client.run(board, report)
    reply(0, analysis)
    expect(report).toHaveBeenCalledWith({ analysis })
    expect(removeItem).toHaveBeenCalledWith(ANALYSIS_CACHE_KEY)
    client.dispose()
  })

  it('reports startup failures and lets the caller retry', () => {
    const factory = vi.fn((): Worker => { throw new Error('Worker unavailable') })
    const client = createAnalysisClient(factory)
    const report = vi.fn()
    client.run(board, report)
    expect(report).toHaveBeenCalledWith({ error: 'Worker unavailable' })
    client.run(board, report)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('terminates an unfinished job when its consumer leaves', () => {
    const { client, workers, reply } = harness()
    const report = vi.fn()
    const cancel = client.run(board, report)
    cancel()
    reply(0, analysis)
    expect(report).not.toHaveBeenCalled()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('reports a worker error, terminates it and retries with a new worker', () => {
    const { client, workers, reply } = harness()
    const report = vi.fn()
    client.run(board, report)
    workers[0].onerror?.call(workers[0] as unknown as Worker, {
      message: 'Worker script failed', preventDefault() {},
    } as ErrorEvent)
    expect(report).toHaveBeenLastCalledWith({ error: 'Worker script failed' })
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    client.run(board, report)
    expect(workers).toHaveLength(2)
    reply(1, analysis)
    expect(report).toHaveBeenLastCalledWith({ analysis })
    client.dispose()
  })
})
