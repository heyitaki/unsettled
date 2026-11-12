// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { AdviceRequest } from '../../engine/advice/protocol'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { recordBuyDev, recordRoll } from '../../model/turn'
import { createAdviceClient } from '../adviceClient'

it('strips UI turn metadata at the advice boundary without changing the stored game', () => {
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }
  const client = createAdviceClient(() => worker as unknown as Worker)
  const game = recordBuyDev(recordRoll(newGame(createBoard('standard4')), 7, {}), null)
  for (const decision of [{ kind: 'turn' }, { kind: 'produce', total: 8 }, { kind: 'recap', games: 1, batch: 0 }] as const) {
    void client.request({ game, observer: 'aki', decision })
    const sent = worker.postMessage.mock.lastCall![0] as { request: AdviceRequest }
    expect(Object.keys(sent.request.game.turn!).sort()).toEqual(['devPlayed', 'playerId', 'progressPlayed', 'rolled'])
    expect(sent.request.game.turn).toEqual({ playerId: 'aki', rolled: 7, devPlayed: false, progressPlayed: game.turn!.progressPlayed })
  }
  expect(game.turn).toMatchObject({ robberMoved: false, devBought: 1 })
  client.dispose()
})
