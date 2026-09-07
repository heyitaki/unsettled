import { expect, it } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame } from '../../model/game'
import { recoveryTabs } from '../saveStatus'

it('puts closed rescues before open tabs so a reopened map exports its latest edits', () => {
  const game = newGame(createBoard('standard4'))
  const closed = { id: 'gone', title: 'Map', game, mapId: 'm1' }
  const open = { id: 'here', title: 'Map', game: newGame(setTile(game.board, { q: 0, r: 0 }, 'ore', 8)), mapId: 'm1' }
  const failures = [{ message: 'closed', tab: closed }, { message: 'open', tab: open }, { message: 'workspace' }]
  expect(recoveryTabs([open], failures)).toEqual([closed, open])
})
