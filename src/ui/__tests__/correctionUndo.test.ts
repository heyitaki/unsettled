import { expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { adjustHand, newGame, type Correction, type Game } from '../../model/game'
import { appendLog, recordCorrection, setActivePlayer } from '../../model/turn'
import { activeTab, reducer, type StoreState } from '../store'

const describe = (correction: Correction) => `Corrected ${JSON.stringify(correction)}`
const started = () => setActivePlayer(newGame(createBoard('standard4')), 'aki')

function state(game: Game): StoreState {
  return {
    tabs: [{ id: 'one', title: 'one', game, past: [], future: [], activePlayerId: 'aki', mapId: null }],
    activeTabId: 'one', tool: { kind: 'none' }, notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
  }
}

const game = (current: StoreState) => activeTab(current).game
const tap = (current: StoreState, delta = 1) => {
  const before = game(current)
  const next = recordCorrection(before, adjustHand(before, 'aki', 'wood', delta), { playerId: 'aki', field: 'wood', delta }, describe)
  return reducer(current, { type: 'commit-game', game: next, correction: true })
}
const act = (current: StoreState) => reducer(current, { type: 'commit-game', game: appendLog(game(current), 'Built a road') })
const undo = (current: StoreState) => reducer(current, { type: 'undo' })
const wood = (current: StoreState) => game(current).stats.aki.hand.wood

it('undoes corrections one tap at a time while the run is open', () => {
  let current = state(started())
  for (let i = 0; i < 3; i += 1) current = tap(current)
  expect(activeTab(current).past).toHaveLength(3)
  expect(wood(undo(current))).toBe(2)
})

it('undoes a closed run in one step once an action follows it', () => {
  const start = started()
  let current = act(state(start))
  const before = game(current)
  for (let i = 0; i < 3; i += 1) current = tap(current)
  const corrected = game(current)
  current = act(current)
  expect(activeTab(current).past).toEqual([start, before, corrected])
  expect(game(undo(current))).toBe(corrected)
  expect(game(undo(undo(current)))).toBe(before)
})

it('closes the run at a board edit, which stays its own undo step', () => {
  let current = act(state(started()))
  const before = game(current)
  current = tap(tap(current))
  const corrected = game(current)
  const board = game(current).board
  current = reducer(current, { type: 'commit', board: { ...board, players: board.players.map((player) => ({ ...player, name: 'Edited' })) } })
  expect(game(current).turn?.correction).toBeUndefined()
  expect(game(current).turn?.log?.at(-1)).toBe(corrected.turn?.log?.at(-1))
  current = tap(current)
  expect(game(current).turn?.log).toHaveLength(3)
  current = act(current)
  expect(wood(undo(current))).toBe(3)
  expect(game(undo(undo(current))).board.players[0].name).toBe('Edited')
  expect(game(undo(undo(undo(current))))).toBe(corrected)
  expect(game(undo(undo(undo(undo(current)))))).toBe(before)
})

it('drops a run whose taps cancel out from the undo stack', () => {
  let current = act(state(started()))
  const before = game(current)
  current = act(tap(tap(current), -1))
  expect(activeTab(current).past.at(-1)).toBe(before)
})
