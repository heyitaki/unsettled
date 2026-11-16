import { expect, it } from 'vitest'
import { addPlayer, createBoard } from '../board'
import { adjustCounter, adjustHand, newGame, type Correction, type Game } from '../game'
import { parseGame, serializeGame } from '../serialization'
import { turnSummary } from '../history'
import { appendLog, endTurn, recordCorrection, recordRoll, setActivePlayer } from '../turn'

const describe = (correction: Correction) => `Corrected ${JSON.stringify(correction)}`
const started = () => setActivePlayer(newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })), 'aki')
const wood = (game: Game, playerId: string, delta: number) =>
  recordCorrection(game, adjustHand(game, playerId, 'wood', delta), { playerId, field: 'wood', delta }, describe)

it('groups corrections between actions into one log line of net changes', () => {
  let game = appendLog(started(), 'Built a road')
  game = wood(game, 'aki', 1)
  game = wood(game, 'aki', 1)
  game = wood(game, 'b', -1)
  game = recordCorrection(game, adjustCounter(game, 'b', 'handUnknown', 1), { playerId: 'b', field: 'handUnknown', delta: 1 }, describe)
  const correction: Correction = { changes: { aki: { wood: 2 }, b: { handUnknown: 1 } } }
  expect(game.turn?.correction).toEqual(correction)
  expect(game.turn?.log).toEqual(['Built a road', describe(correction)])
  expect(game.stats.aki.hand.wood).toBe(2)
})

it('starts a new group after an action or a roll', () => {
  let game = wood(started(), 'aki', 1)
  game = appendLog(game, 'Built a road')
  expect(game.turn?.correction).toBeUndefined()
  game = wood(game, 'aki', 1)
  game = recordRoll(game, 8, {})
  expect(game.turn?.correction).toBeUndefined()
  game = wood(game, 'aki', 1)
  const one = describe({ changes: { aki: { wood: 1 } } })
  expect(game.turn?.log).toEqual([one, 'Built a road', one, one])
})

it('drops the line when a group nets to nothing but keeps the group open', () => {
  let game = appendLog(started(), 'Built a road')
  game = wood(game, 'aki', 1)
  game = wood(game, 'aki', -1)
  expect(game.turn?.log).toEqual(['Built a road'])
  expect(game.turn?.correction).toEqual({ changes: {} })
  game = wood(game, 'aki', 1)
  expect(game.turn?.log).toEqual(['Built a road', describe({ changes: { aki: { wood: 1 } } })])
})

it('records a settled award tie in the group', () => {
  let game = wood(started(), 'aki', 1)
  game = recordCorrection(game, { ...game, awards: { longestRoad: 'b', largestArmy: null } }, { award: 'longestRoad', playerId: 'b' }, describe)
  const correction: Correction = { changes: { aki: { wood: 1 } }, awards: { longestRoad: 'b' } }
  expect(game.turn?.correction).toEqual(correction)
  expect(game.turn?.log).toEqual([describe(correction)])
})

it('leaves an unchanged game and a game with no turn alone', () => {
  const game = started()
  expect(recordCorrection(game, game, { playerId: 'aki', field: 'wood', delta: 1 }, describe)).toBe(game)
  const before = newGame(createBoard('standard4'))
  const after = adjustHand(before, 'aki', 'wood', 1)
  expect(recordCorrection(before, after, { playerId: 'aki', field: 'wood', delta: 1 }, describe)).toBe(after)
})

it('does not carry an open group into the next turn or its record', () => {
  const game = endTurn(wood(started(), 'aki', 1))
  expect(game.turn?.correction).toBeUndefined()
  expect(game.history?.turns[0].log).toEqual([describe({ changes: { aki: { wood: 1 } } })])
  expect(game.history?.turns[0]).not.toHaveProperty('correction')
})

it('round-trips an open group and rejects a malformed one', () => {
  let game = wood(started(), 'aki', 1)
  game = recordCorrection(game, { ...game, awards: { longestRoad: 'aki', largestArmy: null } }, { award: 'longestRoad', playerId: 'aki' }, describe)
  expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
  const empty = wood(wood(started(), 'aki', 1), 'aki', -1)
  expect(parseGame(serializeGame(empty))).toEqual({ ok: true, game: empty })
  for (const correction of [{ changes: { aki: { gold: 1 } } }, { changes: { aki: { wood: 0.5 } } }, { changes: { aki: {} } }, { changes: {}, awards: {} }, { changes: {}, awards: { mostCities: 'aki' } }, { changes: {}, extra: 1 }]) {
    expect(parseGame(serializeGame({ ...game, turn: { ...game.turn!, correction: correction as Correction } })).ok).toBe(false)
  }
  // The next tap would overwrite the last line, so a run must own it.
  expect(parseGame(serializeGame({ ...game, turn: { ...game.turn!, log: ['Built a road'] } })).ok).toBe(false)
})

it('drops a settled award from the line once the game no longer gives it', () => {
  let game = recordCorrection(started(), { ...started(), awards: { longestRoad: 'b', largestArmy: null } }, { award: 'longestRoad', playerId: 'b' }, describe)
  const moved = { ...adjustHand(game, 'aki', 'wood', 1), awards: { longestRoad: 'aki', largestArmy: null } }
  game = recordCorrection(game, moved, { playerId: 'aki', field: 'wood', delta: 1 }, describe)
  expect(game.turn?.correction).toEqual({ changes: { aki: { wood: 1 } } })
  expect(game.turn?.log).toEqual([describe({ changes: { aki: { wood: 1 } } })])
})

it('summarizes a correction line without its details', () => {
  expect(turnSummary(['Built a road', 'Corrected Red: wood +1, ore −1 · Blue: sheep +1'])).toBe('Built a road, corrected the ledger')
  expect(turnSummary(['Corrected Red: wood +1', 'Built a road', 'Corrected Red: ore +1'])).toBe('Corrected the ledger, built a road')
})
