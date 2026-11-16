import { describe, expect, it } from 'vitest'
import { createBoard } from '../board'
import { mergeScreenshot, newGame } from '../game'
import { parseGame, serializeGame } from '../serialization'
import { PLAYER_PALETTE } from '../types'

const print = '123456'.repeat(64)
const game = () => ({ ...newGame(createBoard('standard4')), avatars: { aki: print } })

describe('avatar serialization', () => {
  it('round-trips prints without aliasing the input', () => {
    const input = game()
    expect(parseGame(serializeGame(input))).toEqual({ ok: true, game: input })
    const parsed = parseGame(input)
    if (!parsed.ok) throw new Error(parsed.errors.join(', '))
    input.avatars.aki = 'abcdef'.repeat(64)
    expect(parsed.game.avatars).toEqual({ aki: print })
  })

  it.each([
    { absent: print }, { aki: 'abcdef' }, { aki: 'AB'.repeat(192) },
    { aki: 'gg'.repeat(192) }, { aki: `${print}\n` }, { aki: 123 }, null, [],
  ])('rejects invalid avatars %j', (avatars) => {
    expect(parseGame({ ...game(), avatars }).ok).toBe(false)
  })
})

describe('screenshot avatar merge', () => {
  it('carries prints under the saved ids, prunes departed players and keeps saved names', () => {
    const saved = game()
    const shot = newGame({ ...saved.board, players: [
      { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red },
      { id: 'aki', name: 'Blue', color: PLAYER_PALETTE.blue },
    ], mePlayerId: 'p1' })
    shot.avatars = { p1: 'abcdef'.repeat(64), aki: print }
    const merged = mergeScreenshot(saved, shot, { roster: true, order: true, picks: true, unorderedPicks: [], hands: [], points: {}, knights: [] })
    expect(merged.avatars).toEqual({ aki: shot.avatars.p1, 'aki-2': print })
    expect(merged.board.players[0].name).toBe('aki')
    expect(saved.avatars).toEqual({ aki: print })
    expect(parseGame(serializeGame(merged))).toEqual({ ok: true, game: merged })
    const removed = mergeScreenshot(merged, newGame(saved.board), { roster: true, order: true, picks: true, unorderedPicks: [], hands: [], points: {}, knights: [] })
    expect(removed.avatars).toEqual({ aki: shot.avatars.p1 })
  })
})
