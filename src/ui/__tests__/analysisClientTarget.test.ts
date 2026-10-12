import { expect, it, vi } from 'vitest'
import type { DraftAnalysis } from '../../engine/analysisProtocol'
import type { AnalysisRequest } from '../../engine/analysisProtocol'
import { inferDraftState } from '../../engine/draft'
import { createBoard } from '../../model/board'
import { createAnalysisClient } from '../analysisClient'

it('caches each target separately and rejects a late response for another target on the same board', () => {
  const workers: {
    postMessage: ReturnType<typeof vi.fn<(request: AnalysisRequest) => void>>
    terminate: ReturnType<typeof vi.fn>
    onmessage: Worker['onmessage']
  }[] = []
  const client = createAnalysisClient(() => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null }
    workers.push(worker)
    return worker as unknown as Worker
  })
  const board = createBoard('standard4')
  const first: DraftAnalysis = {
    status: 'no-production', draft: inferDraftState(board), recommendations: [], takenBeforeFirstPick: [], warnings: [],
  }
  const later: DraftAnalysis = { ...first, status: 'no-availability' }
  const reply = (workerIndex: number, analysis: DraftAnalysis) => {
    const worker = workers[workerIndex]
    const request = worker.postMessage.mock.calls.at(-1)![0]
    worker.onmessage?.call(worker as unknown as Worker, { data: { id: request.id, analysis } } as MessageEvent)
  }
  const report = vi.fn()
  client.run(board, report)
  reply(0, first)
  const stale = vi.fn()
  client.run(board, stale, 7)
  expect(workers[0].postMessage.mock.calls.at(-1)![0].targetPick).toBe(7)
  client.run(board, report, 6)
  reply(0, later)
  expect(stale).not.toHaveBeenCalled()
  reply(1, later)
  expect(report).toHaveBeenLastCalledWith({ analysis: later })
  client.run(board, report)
  expect(report).toHaveBeenLastCalledWith({ analysis: first })
  client.run(board, report, 6)
  expect(report).toHaveBeenLastCalledWith({ analysis: later })
  expect(workers[1].postMessage).toHaveBeenCalledOnce()
  client.dispose()
})
