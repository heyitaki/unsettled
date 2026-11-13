import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse, Decision } from '../../engine/advice/protocol'
import { createEngine } from '../../engine/advice/wasm'
import { appendLog, endTurn, recordRoll, setActivePlayer } from '../../model/turn'
import { createAdviceClient } from '../adviceClient'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function historyRequest() {
  const { cases }: { cases: { request: AdviceRequest; response: AdviceResponse }[] } = JSON.parse(
    readFileSync('simulator/fixtures/advice-parity.json', 'utf8'),
  )
  const fixture = cases.find(({ request }) => request.decision.kind === 'produce')!
  const playerId = fixture.request.game.board.players[0].id
  let game = setActivePlayer({ ...fixture.request.game, turn: undefined }, playerId)
  game = endTurn(appendLog(recordRoll(game, 8, {}), 'Built a road'))
  game = appendLog(recordRoll(game, 6, {
    [playerId]: { wood: 1, sheep: 0, wheat: 0, brick: 0, ore: 0 },
  }), 'Bought a dev card')
  return { request: { ...fixture.request, observer: playerId, game }, expected: fixture.response }
}

it('keeps history and logs in the save while the shipped adviser still accepts the request', async () => {
  const { request, expected } = historyRequest()
  const { game } = request
  const { advise } = await createEngine(readFileSync('src/engine/advice/engine.wasm'), () => {})
  const before = structuredClone(game)
  const worker = {
    onmessage: null as Worker['onmessage'],
    postMessage({ id, request }: { id: number; request: AdviceRequest }) {
      const response: AdviceResponse = JSON.parse(advise(JSON.stringify(request)))
      queueMicrotask(() => worker.onmessage?.call(worker as unknown as Worker, { data: { id, response } } as MessageEvent))
    },
    terminate() {},
  }
  const client = createAdviceClient(() => worker as unknown as Worker)
  try {
    const response = await client.request(request)
    expect(response).toEqual(expected)
    expect(game).toEqual(before)
    expect(game.history?.turns).toHaveLength(1)
    expect(game.turn?.log).toEqual(['Bought a dev card'])
  } finally {
    client.dispose()
  }
})

it('filters every decision, including recap and a game without a current turn, before posting to a worker', () => {
  const { request } = historyRequest()
  const before = structuredClone(request)
  const sent: AdviceRequest[] = []
  const worker = { postMessage: ({ request }: { request: AdviceRequest }) => sent.push(request), terminate() {} }
  const client = createAdviceClient(() => worker as unknown as Worker)
  const decisions: Decision[] = [
    { kind: 'turn' }, { kind: 'preRoll' }, { kind: 'discard' }, { kind: 'robber' },
    { kind: 'produce', total: 8 }, { kind: 'recap', games: 1, batch: 0 },
    { kind: 'tradeResponse', proposer: request.observer, give: 'wood', get: 'ore', count: 1 },
  ]
  try {
    for (const decision of decisions) void client.request({ ...request, decision })
    for (const outgoing of sent) {
      expect(Object.hasOwn(outgoing.game, 'history')).toBe(false)
      expect(Object.keys(outgoing.game.turn!).sort()).toEqual(['devPlayed', 'playerId', 'progressPlayed', 'rolled'])
      expect(outgoing.game.board).toBe(request.game.board)
      expect(outgoing.game.stats).toBe(request.game.stats)
      expect(outgoing.game.awards).toBe(request.game.awards)
      expect(outgoing.game.devHand).toBe(request.game.devHand)
    }
    expect(sent.map(({ decision }) => decision)).toEqual(decisions)
    const { turn: _, ...game } = request.game
    void client.request({ ...request, game, decision: { kind: 'recap', games: 1, batch: 0 } })
    expect(Object.hasOwn(sent.at(-1)!.game, 'history')).toBe(false)
    expect(Object.hasOwn(sent.at(-1)!.game, 'turn')).toBe(false)
    expect(request).toEqual(before)
  } finally {
    client.dispose()
  }
})

it('filters a full game received directly by the advice worker before the wasm call', async () => {
  const { request, expected } = historyRequest()
  const before = structuredClone(request)
  const worker = {
    onmessage: null as ((event: MessageEvent<{ id: number; request: AdviceRequest }>) => Promise<void>) | null,
    postMessage: vi.fn(),
  }
  vi.stubGlobal('self', worker)
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(readFileSync('src/engine/advice/engine.wasm'))))
  await import('../../engine/advice/advice.worker')
  await worker.onmessage!({ data: { id: 1, request } } as MessageEvent)
  expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, response: expected })
  expect(request).toEqual(before)
})
