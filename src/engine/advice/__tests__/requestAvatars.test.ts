import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createBoard } from '../../../model/board'
import { newGame } from '../../../model/game'
import type { AdviceRequest, AdviceResponse } from '../protocol'
import { engineRequest } from '../request'
import { createEngine } from '../wasm'

it('strips avatars from engine requests without changing the saved game', () => {
  const game = { ...newGame(createBoard('standard4')), avatars: { aki: '123456'.repeat(64) } }
  const request = engineRequest({ game, observer: 'aki', decision: { kind: 'turn' } })
  expect(request.game).not.toHaveProperty('avatars')
  expect(request.game.board).toBe(game.board)
  expect(game.avatars).toEqual({ aki: '123456'.repeat(64) })
})

it('sends narrowed unseen cards to the engine', () => {
  const game = newGame(createBoard('standard4'))
  game.stats.aki = { ...game.stats.aki, handUnknown: 2, handUnknownAmong: [['wood', 'brick']] }
  const request = engineRequest({ game, observer: 'aki', decision: { kind: 'turn' } })
  expect(request.game.stats.aki.handUnknownAmong).toEqual([['wood', 'brick']])
})

it('ranks moves differently once a rival\'s unseen cards are narrowed', async () => {
  const { cases }: { cases: { name: string; request: AdviceRequest; response: AdviceResponse }[] } = JSON.parse(
    readFileSync('simulator/fixtures/advice-parity.json', 'utf8'),
  )
  const { request, response } = cases.find(({ name }) => name === 'extension6-83-turn')!
  const stats = Object.fromEntries(Object.entries(request.game.stats).map(([id, { handUnknownAmong: _among, ...rest }]) => [id, rest]))
  const { advise } = await createEngine(readFileSync(new URL('../engine.wasm', import.meta.url)), () => {})
  const narrowed = JSON.parse(advise(JSON.stringify(engineRequest(request))))
  expect(narrowed).toEqual(response)
  expect(JSON.parse(advise(JSON.stringify(engineRequest({ ...request, game: { ...request.game, stats } }))))).not.toEqual(narrowed)
})
