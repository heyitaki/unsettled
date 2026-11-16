import { expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { correctionLine } from '../bestMoves'

it('words a correction group by player, then settled awards', () => {
  const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  const me = board.players[0]
  expect(correctionLine(board, {
    changes: { [me.id]: { wood: 2, handUnknown: -1, knight: 1 }, b: { knights: 1, devCards: -1, vpCards: 1 } },
    awards: { longestRoad: 'b' },
  })).toBe(`Corrected ${me.name}: wood +2, unseen cards −1, knight +1 · Bee: knights played +1, unknown dev cards −1, victory points +1 · Longest road to Bee`)
  expect(correctionLine(board, { changes: {}, awards: { largestArmy: me.id } })).toBe(`Corrected largest army to ${me.name}`)
  expect(correctionLine(board, { changes: { gone: { ore: 1 } } })).toBe('Corrected Removed player: ore +1')
})
