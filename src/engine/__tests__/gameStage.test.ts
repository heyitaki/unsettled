import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding } from '../../model/board'
import { adjustCounter, newGame } from '../../model/game'
import { gameStage } from '../gameStage'
import { boardGrid } from '../../model/layouts'
import { endTurn, setActivePlayer } from '../../model/turn'

const emptyBoard = () => addPlayer(addPlayer(createBoard('standard4'),
  { id: 'red', name: 'Red', color: '#d24b3e' }),
  { id: 'blue', name: 'Blue', color: '#3063ba' })
// One city ends the draft, so these games are past it.
const game = () => newGame(placeBuilding(emptyBoard(), boardGrid('standard4').vertexIds[9], 'red', 'city'))

describe('gameStage', () => {
  it('is not started until a turn is recorded, even with winning points', () => {
    expect(gameStage(game())).toBe('not-started')
    expect(gameStage(adjustCounter(game(), 'blue', 'vpCards', 10))).toBe('not-started')
  })

  it('is not started while the board is back in the draft after Start game', () => {
    expect(gameStage(setActivePlayer(newGame(emptyBoard()), 'red'))).toBe('not-started')
  })

  it('shows the current turn number while every player is under 10 VP', () => {
    const started = setActivePlayer(adjustCounter(game(), 'blue', 'vpCards', 9), 'red')
    expect(gameStage(started)).toBe(1)
    expect(gameStage(endTurn(endTurn(started)))).toBe(3)
    expect(gameStage({ ...started, history: undefined })).toBe(1)
  })

  it.each([10, 11])('finishes when another player has %i recorded VP', (points) => {
    expect(gameStage(setActivePlayer(adjustCounter(game(), 'blue', 'vpCards', points), 'red'))).toBe('finished')
  })

  it('counts buildings and awards with recorded VP cards, as the Ledger does', () => {
    const board = placeBuilding(game().board, boardGrid('standard4').vertexIds[0], 'blue', 'city')
    let started = setActivePlayer(newGame(board), 'red')
    started = adjustCounter(started, 'blue', 'knights', 3)
    started = adjustCounter(started, 'blue', 'vpCards', 5)
    expect(gameStage(started)).toBe(1)
    expect(gameStage(adjustCounter(started, 'blue', 'vpCards', 1))).toBe('finished')
  })
})
