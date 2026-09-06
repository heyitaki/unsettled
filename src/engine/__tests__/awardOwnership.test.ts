import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeRoad } from '../../model/board'
import { hexEdgeIds } from '../../model/coords'
import { adjustCounter, newGame, type Game } from '../../model/game'
import { parseGame, serializeGame } from '../../model/serialization'
import { activeTab, reducer, type StoreState } from '../../ui/store'
import { computeStandings, initializeAwards, setAwardHolder, trackAwards } from '../stats'

const board = () => addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
const army = (game: Game, id: string, delta: number) => trackAwards(game, adjustCounter(game, id, 'knights', delta))

describe('recorded award ownership', () => {
  it('retains the army holder on ties and transfers it only when beaten', () => {
    let game = initializeAwards(newGame(board()))
    game = army(game, 'aki', 3)
    game = army(game, 'b', 3)
    expect(game.awards?.largestArmy).toBe('aki')
    expect(computeStandings(game)[0].hasLargestArmy).toBe(true)
    game = army(game, 'b', 1)
    expect(game.awards?.largestArmy).toBe('b')
  })

  it('leaves imported ties unknown until corrected and round-trips the correction', () => {
    let imported = adjustCounter(newGame(board()), 'aki', 'knights', 3)
    imported = adjustCounter(imported, 'b', 'knights', 3)
    const game = initializeAwards(imported)
    expect(game.awards?.largestArmy).toBeNull()
    const corrected = setAwardHolder(game, 'largestArmy', 'b')
    expect(parseGame(serializeGame(corrected))).toEqual({ ok: true, game: corrected })
    expect(computeStandings(corrected)[1].hasLargestArmy).toBe(true)
    expect(parseGame({ ...corrected, awards: { ...corrected.awards, largestArmy: 'missing' } }).ok).toBe(false)
  })

  it('uses the recorded road holder when imported road order cannot identify it', () => {
    let roads = board()
    for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) roads = placeRoad(roads, edge, 'aki')
    for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) roads = placeRoad(roads, edge, 'b')
    const game = initializeAwards(newGame(roads))
    expect(game.awards?.longestRoad).toBeNull()
    const corrected = setAwardHolder(game, 'longestRoad', 'b')
    const reordered = trackAwards(corrected, { ...corrected, board: { ...roads, roads: [...roads.roads].reverse() } })
    expect(computeStandings(reordered)[1].hasLongestRoad).toBe(true)
  })

  it('restores award corrections with the same undo and redo as the rest of the game', () => {
    let game = adjustCounter(newGame(board()), 'aki', 'knights', 3)
    game = initializeAwards(adjustCounter(game, 'b', 'knights', 3))
    const state: StoreState = {
      tabs: [{ id: 'one', title: 'One', game, past: [], future: [], activePlayerId: 'aki', mapId: null }],
      activeTabId: 'one', tool: { kind: 'none' }, notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
    }
    const edited = reducer(state, { type: 'commit-game', game: setAwardHolder(game, 'largestArmy', 'b') })
    const undone = reducer(edited, { type: 'undo' })
    expect(activeTab(undone).game.awards?.largestArmy).toBeNull()
    expect(activeTab(reducer(undone, { type: 'redo' })).game.awards?.largestArmy).toBe('b')
  })
})
