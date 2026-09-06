import { describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import type { DraftAnalysis } from '../../engine/analyze'
import { inferDraftState } from '../../engine/draft'
import { createAnalysisClient } from '../analysisClient'

function harness() {
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
  })
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
