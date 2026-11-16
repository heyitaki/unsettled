import { describe, expect, it } from 'vitest'
import { createBoard } from '../board'
import { newGame } from '../game'
import { automaticTitle, isAutomaticTitle } from '../names'
import { isDefaultName } from '../people'
import { PLAYER_PALETTE } from '../types'

const game = (...names: string[]) => newGame({
  ...createBoard('standard4'),
  players: names.map((name, index) => ({ id: `p${index + 1}`, name, color: Object.values(PLAYER_PALETTE)[index] })),
  mePlayerId: null,
})
const nov5 = new Date(2026, 10, 5, 12)

describe('default names', () => {
  it('are colour names and Player <n>, in any case', () => {
    for (const name of ['Red', 'blue', 'WHITE', 'Brown', 'Player 1', 'player 12']) expect(isDefaultName(name)).toBe(true)
  })
  it('exclude real names, including the starting aki', () => {
    for (const name of ['aki', 'alice', 'Player', 'Player one', 'Reddy', 'Player 2b']) expect(isDefaultName(name)).toBe(false)
  })
})

describe('automatic board titles', () => {
  it('lists every player in seat order under the unpadded creation date', () => {
    expect(automaticTitle(game('alice', 'Red', 'bob'), nov5, new Set())).toBe('11/5 alice, Red, bob')
  })
  it('falls back when every player has a default name', () => {
    expect(automaticTitle(game('Red', 'Player 2'), nov5, new Set())).toBeNull()
  })
  it('falls back for a fresh board, whose only player is the starting aki', () => {
    expect(automaticTitle(newGame(createBoard('standard4')), nov5, new Set())).toBeNull()
  })
  it('appends 2, then 3, to a title another board holds', () => {
    expect(automaticTitle(game('alice'), nov5, new Set(['11/5 alice']))).toBe('11/5 alice 2')
    expect(automaticTitle(game('alice'), nov5, new Set(['11/5 alice', '11/5 alice 2']))).toBe('11/5 alice 3')
  })
})

describe('isAutomaticTitle', () => {
  it('accepts the Board fallback and dated titles', () => {
    for (const title of ['Board 1', 'Board 12', '11/5 alice, Red', '1/30 bob 2']) expect(isAutomaticTitle(title)).toBe(true)
  })
  it('rejects typed titles', () => {
    for (const title of ['Game night', 'settled-5p-draft-start', 'Board', 'Board one', '11/5']) expect(isAutomaticTitle(title)).toBe(false)
  })
})
