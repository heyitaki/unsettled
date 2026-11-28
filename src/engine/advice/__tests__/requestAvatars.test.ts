import { expect, it } from 'vitest'
import { createBoard } from '../../../model/board'
import { newGame } from '../../../model/game'
import { engineRequest } from '../request'

it('strips avatars from engine requests without changing the saved game', () => {
  const game = { ...newGame(createBoard('standard4')), avatars: { aki: '123456'.repeat(64) } }
  const request = engineRequest({ game, observer: 'aki', decision: { kind: 'turn' } })
  expect(request.game).not.toHaveProperty('avatars')
  expect(request.game.board).toBe(game.board)
  expect(game.avatars).toEqual({ aki: '123456'.repeat(64) })
})

it('sends narrowed unseen cards to the engine as plain unseen cards', () => {
  const game = newGame(createBoard('standard4'))
  game.stats.aki = { ...game.stats.aki, handUnknown: 2, handUnknownAmong: [['wood', 'brick']] }
  const request = engineRequest({ game, observer: 'aki', decision: { kind: 'turn' } })
  expect(request.game.stats.aki).toEqual({ ...game.stats.aki, handUnknownAmong: undefined })
  expect(request.game.stats.aki).not.toHaveProperty('handUnknownAmong')
  expect(game.stats.aki.handUnknownAmong).toEqual([['wood', 'brick']])
})
