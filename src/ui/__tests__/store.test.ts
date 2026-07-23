import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { reducer, type StoreState } from '../store'

describe('editor history', () => {
  it('reconciles the active player after undo and redo', () => {
    const original = createBoard('standard4')
    const withPlayer = addPlayer(original, {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    const state: StoreState = {
      board: withPlayer,
      tool: { kind: 'piece', tier: 'road' },
      activePlayerId: 'b',
      past: [original],
      future: [],
      notice: null,
      highlight: null,
    }

    const undone = reducer(state, { type: 'undo' })
    expect(undone.board).toBe(original)
    expect(undone.activePlayerId).toBe('aki')

    const redone = reducer(undone, { type: 'redo' })
    expect(redone.board).toBe(withPlayer)
    expect(redone.board.players.some((player) => player.id === redone.activePlayerId)).toBe(true)
  })
})
