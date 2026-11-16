// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBoard, renamePlayer } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { PLAYER_PALETTE } from '../../model/types'
import { listMaps, loadMap, saveMap } from '../../persistence/localStorage'
import { createLibraryAutosave, type LibraryAutosave } from '../libraryAutosave'
import { activeTab, reducer, type StoreAction, type StoreState, type TabState } from '../store'

const roster = () => newGame({ ...createBoard('standard4'), players: [
  { id: 'red', name: 'Red', color: PLAYER_PALETTE.red },
  { id: 'blue', name: 'Blue', color: PLAYER_PALETTE.blue },
], mePlayerId: null })
const named = () => newGame(renamePlayer(roster().board, 'red', 'alice'))
const tab = (id: string, title: string, game: Game, mapId: string | null = null): TabState => ({
  id, title, game, mapId, past: [], future: [], activePlayerId: 'red',
})
const save = (name: string, game: Game) => {
  const result = saveMap(name, game)
  if (!result.ok) throw new Error(result.error)
  return result.id
}
let autosave: LibraryAutosave
function harness(tabs: TabState[]) {
  let state: StoreState = {
    tabs, activeTabId: tabs[0].id, tool: { kind: 'none' }, notice: null,
    noticeSeq: 0, highlight: null, mapsRevision: 0,
  }
  const actions: StoreAction[] = []
  const dispatch = (action: StoreAction) => {
    actions.push(action)
    state = reducer(state, action)
    autosave.arm(state.tabs)
  }
  autosave = createLibraryAutosave(dispatch, tabs)
  return { dispatch, actions, active: () => activeTab(state), tabs: () => state.tabs }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 5, 12))
})
afterEach(() => {
  autosave?.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('retitles a linked automatic tab and map on a player rename using the creation date, without another undo step', () => {
  const game = roster()
  const mapId = save('Board 1', game)
  vi.setSystemTime(new Date(2026, 10, 15, 12))
  const store = harness([tab('one', 'Board 1', game, mapId)])
  store.dispatch({ type: 'commit', board: renamePlayer(game.board, 'red', 'alice') })
  expect(store.active().title).toBe('11/5 alice, Blue')
  expect(store.active().past).toEqual([game])
  vi.advanceTimersByTime(1000)
  expect(listMaps().maps.map(({ name }) => name)).toEqual(['11/5 alice, Blue'])
  expect(listMaps().maps[0].createdAt).toBe(new Date(2026, 10, 5, 12).getTime())
  expect(loadMap(mapId)).toEqual({ ok: true, game: store.active().game })
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  autosave.arm(store.tabs())
  vi.advanceTimersByTime(2000)
  expect(writes).not.toHaveBeenCalled()
  expect(store.actions.filter(({ type }) => type === 'tab-rename')).toHaveLength(1)
})

it('keeps a typed title on the tab and its map', () => {
  const game = roster()
  const mapId = save('Game night', game)
  const store = harness([tab('one', 'Game night', game, mapId)])
  store.dispatch({ type: 'commit', board: renamePlayer(game.board, 'red', 'alice') })
  vi.advanceTimersByTime(1000)
  expect(store.active().title).toBe('Game night')
  expect(listMaps().maps[0].name).toBe('Game night')
})

it('reserves names from open tabs and closed maps, keeping a second board suffix on later recomputes', () => {
  const game = named()
  const store = harness([tab('one', 'Board 1', roster()), tab('two', 'Board 2', roster())])
  store.dispatch({ type: 'commit-game', game })
  store.dispatch({ type: 'tab-select', id: 'two' })
  store.dispatch({ type: 'commit-game', game })
  expect(store.tabs().map(({ title }) => title)).toEqual(['11/5 alice, Blue', '11/5 alice, Blue 2'])
  vi.advanceTimersByTime(1000)
  store.dispatch({ type: 'commit-game', game: { ...game, stats: { ...game.stats, red: { ...game.stats.red, handUnknown: 1 } } } })
  vi.advanceTimersByTime(1000)
  expect(store.active().title).toBe('11/5 alice, Blue 2')
  store.dispatch({ type: 'tab-select', id: 'one' })
  store.dispatch({ type: 'commit-game', game: { ...game, stats: { ...game.stats, blue: { ...game.stats.blue, handUnknown: 1 } } } })
  expect(store.active().title).toBe('11/5 alice, Blue')
  store.dispatch({ type: 'tab-close', id: 'two' })
  store.dispatch({ type: 'tab-add', game: roster(), title: 'Board 2' })
  store.dispatch({ type: 'commit-game', game })
  expect(store.active().title).toBe('11/5 alice, Blue 3')
})

it('falls back to the first free Board number when every player has a default name', () => {
  const game = named()
  save('Board 1', roster())
  const mapId = save('11/5 alice, Blue', game)
  const store = harness([tab('one', '11/5 alice, Blue', game, mapId), tab('two', 'Board 2', roster())])
  store.dispatch({ type: 'commit', board: renamePlayer(game.board, 'red', 'Player 3') })
  expect(store.active().title).toBe('Board 3')
  expect(listMaps().maps.find(({ id }) => id === mapId)?.name).toBe('Board 3')
  store.dispatch({ type: 'commit', board: renamePlayer(store.active().game.board, 'red', 'Green') })
  expect(store.active().title).toBe('Board 3')
})

it('retitles seat reorders and undo without changing the number of game edits', () => {
  const game = named()
  const store = harness([tab('one', '11/5 alice, Blue', game)])
  store.dispatch({ type: 'commit', board: { ...game.board, players: [...game.board.players].reverse() } })
  expect(store.active().title).toBe('11/5 Blue, alice')
  expect(store.active().past).toHaveLength(1)
  store.dispatch({ type: 'undo' })
  expect(store.active().title).toBe('11/5 alice, Blue')
  expect(store.active().past).toHaveLength(0)
})

it('falls back for a fresh game even with the real starting name aki', () => {
  const store = harness([tab('one', '11/5 alice, Blue', named())])
  store.dispatch({ type: 'commit-game', game: newGame(createBoard('standard4')) })
  expect(store.active().title).toBe('Board 1')
  vi.advanceTimersByTime(1000)
  expect(listMaps().maps).toEqual([])
})
