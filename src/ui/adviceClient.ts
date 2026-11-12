import type { AdviceRequest, AdviceResponse, Decision } from '../engine/advice/protocol'
import type { Game } from '../model/game'

export function decisionKey(decision: Decision): string {
  switch (decision.kind) {
    case 'recap': return JSON.stringify({ kind: decision.kind, games: decision.games, batch: decision.batch })
    case 'produce': return JSON.stringify({ kind: decision.kind, total: decision.total })
    case 'tradeResponse': return JSON.stringify({ kind: decision.kind, proposer: decision.proposer, give: decision.give, get: decision.get, count: decision.count })
    default: return JSON.stringify({ kind: decision.kind })
  }
}

export function createAdviceClient(factory: () => Worker) {
  const recapWorkers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1))
  const cache = new WeakMap<Game, Map<string, AdviceResponse>>()
  const pending = new Map<number, { request: AdviceRequest; key: string; resolve: (response: AdviceResponse) => void }>()
  const workers = new Map<number, Worker>()
  let sequence = 0
  const dispose = () => {
    pending.clear()
    for (const worker of workers.values()) worker.terminate()
    workers.clear()
  }
  const fail = (error: string) => {
    const waiting = [...pending.values()]
    dispose()
    for (const request of waiting) request.resolve({ error })
  }
  return {
    recapWorkers,
    request(request: AdviceRequest): Promise<AdviceResponse> {
      const key = JSON.stringify([request.observer, decisionKey(request.decision)])
      const cached = cache.get(request.game)?.get(key)
      if (cached) return Promise.resolve(cached)
      return new Promise((resolve) => {
        const id = ++sequence
        pending.set(id, { request, key, resolve })
        try {
          // With one recap worker the batches arrive one at a time, so a pool would be torn down and rebuilt between them.
          const slot = request.decision.kind === 'recap' && recapWorkers > 1 ? request.decision.batch % recapWorkers : -1
          let worker = workers.get(slot)
          if (!worker) {
            worker = factory()
            workers.set(slot, worker)
            const started = worker
            worker.onmessage = (event: MessageEvent<{ id: number; response: AdviceResponse }>) => {
              if (workers.get(slot) !== started) return
              const job = pending.get(event.data.id)
              if (!job) return
              pending.delete(event.data.id)
              const { response } = event.data
              if (!('error' in response)) {
                let entries = cache.get(job.request.game)
                if (!entries) {
                  entries = new Map()
                  cache.set(job.request.game, entries)
                }
                entries.set(job.key, response)
              }
              if (job.request.decision.kind === 'recap'
                && ![...pending.values()].some(({ request }) => request.decision.kind === 'recap')) {
                for (const [slot, worker] of workers) {
                  if (slot === -1) continue
                  worker.terminate()
                  workers.delete(slot)
                }
              }
              job.resolve(response)
            }
            worker.onerror = (event) => {
              event.preventDefault()
              if (workers.get(slot) !== started) return
              fail(event.message || 'Advice stopped unexpectedly')
            }
            worker.onmessageerror = () => {
              if (workers.get(slot) === started) fail('Unable to read advice')
            }
          }
          // The engine rejects unknown turn fields, and robberMoved and devBought only drive the panel.
          let outgoing = request
          if (request.game.turn) {
            const { playerId, rolled, devPlayed, progressPlayed } = request.game.turn
            outgoing = { ...request, game: { ...request.game, turn: { playerId, rolled, devPlayed, progressPlayed } } }
          }
          worker.postMessage({ id, request: outgoing })
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Unable to start advice')
        }
      })
    },
    cancelAll: () => { if (pending.size > 0) dispose() },
    dispose,
  }
}
