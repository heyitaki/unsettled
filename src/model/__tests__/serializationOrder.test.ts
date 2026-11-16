import { expect, it } from 'vitest'
import { createBoard } from '../board'
import { newGame, type Game } from '../game'
import { gameSignature, parseGame, serializeGame } from '../serialization'

it('serializes avatars inserted before awards identically to the parsed game', () => {
  const game: Game = {
    ...newGame(createBoard('standard4')),
    avatars: { aki: '123456'.repeat(64) },
    awards: { longestRoad: null, largestArmy: null },
  }
  const parsed = parseGame(game)
  if (!parsed.ok) throw new Error(parsed.errors.join(', '))
  expect(serializeGame(game)).toBe(serializeGame(parsed.game))
  expect(gameSignature(game)).toBe(gameSignature(parsed.game))
})

it('writes all top-level fields in the fixed order, skipping absent fields', () => {
  const base = newGame(createBoard('standard4'))
  const counts = { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  const game: Game = {
    history: { start: { buildings: [], roads: [], robber: null, stats: base.stats }, turns: [] },
    avatars: { aki: '123456'.repeat(64) },
    devHand: { playerId: 'aki', playable: counts, bought: counts },
    turn: { playerId: 'aki', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } },
    awards: { longestRoad: null, largestArmy: null },
    ...base,
  }
  expect(Object.keys(JSON.parse(serializeGame(game))))
    .toEqual(['schemaVersion', 'board', 'stats', 'awards', 'turn', 'devHand', 'avatars', 'history'])
  expect(Object.keys(JSON.parse(serializeGame(base)))).toEqual(['schemaVersion', 'board', 'stats'])
})
