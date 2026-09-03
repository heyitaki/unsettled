// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { deleteMap, listMaps, loadMap, saveMap } from '../../persistence/localStorage'
import { createLibraryAutosave } from '../libraryAutosave'
import { activeTab, reducer, type StoreAction, type StoreState, type TabState } from '../store'

const blank = () => newGame(createBoard('standard4'))

const painted = (game: Game, q = 0, r = 0, token = 6): Game =>
  ({ ...game, board: setTile(game.board, { q, r }, 'wheat', token) })

function tab(id: string, game = blank(), extra: Partial<TabState> = {}): TabState {
  return {
    id,
    title: id,
    game,
    past: [],
    future: [],
    activePlayerId: game.board.players[0].id,
    mapId: null,
    ...extra,
  }
}

function state(tabs: TabState[], activeTabId = tabs[0].id): StoreState {
  return {
    tabs,
    activeTabId,
    tool: { kind: 'tile', tile: 'wood' },
    notice: null,
    noticeSeq: 0,
    highlight: null,
    mapsRevision: 0,
  }
}

// The provider's wiring in miniature: the autosave sees the tab set after
// every commit, including the commits its own dispatches cause.
function harness(initial: StoreState) {
  let current = initial
  const dispatched: StoreAction[] = []
  const dispatch = (action: StoreAction) => {
    dispatched.push(action)
    if (action.type === 'tab-close' && action.discard === true) autosave.forget(action.id)
    current = reducer(current, action)
    autosave.arm(current.tabs)
  }
  const autosave = createLibraryAutosave(dispatch, initial.tabs)
  const edit = (game: Game) => dispatch({ type: 'commit-game', game })
  return {
    dispatch,
    edit,
    autosave,
    dispatched,
    state: () => current,
    active: () => activeTab(current),
    notices: () => dispatched.filter((action) => action.type === 'notice'),
  }
}

const savedId = (name: string, game: Game): string => {
  const result = saveMap(name, game)
  if (!result.ok) throw new Error(result.error)
  return result.id
}

const loaded = (id: string): Game => {
  const result = loadMap(id)
  if (!result.ok) throw new Error(result.errors.join(', '))
  return result.game
}

const mapNames = () => listMaps().maps.map((map) => map.name)

describe('library autosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('never writes a blank new tab', () => {
    const store = harness(state([tab('t1')]))
    store.dispatch({ type: 'tab-add' })
    vi.advanceTimersByTime(2000)
    expect(mapNames()).toEqual([])
    expect(store.state().tabs.every((entry) => entry.mapId === null)).toBe(true)
  })

  it('creates one map named after the tab and links it on the first edit', () => {
    const store = harness(state([tab('Thursday game')]))
    const game = painted(store.active().game)
    store.edit(game)
    vi.advanceTimersByTime(499)
    expect(mapNames()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(mapNames()).toEqual(['Thursday game'])
    const { mapId } = store.active()
    expect(mapId).not.toBeNull()
    expect(loaded(mapId as string)).toEqual(game)
    // The library changed outside React; the panels re-read off this.
    expect(store.dispatched.some((action) => action.type === 'maps-changed')).toBe(true)
  })

  it('coalesces edits inside the debounce into one write', () => {
    const store = harness(state([tab('t1')]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(100)
    const last = painted(store.active().game, 1, 0, 8)
    store.edit(last)
    vi.advanceTimersByTime(1000)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(mapNames()).toEqual(['t1'])
    expect(loaded(store.active().mapId as string)).toEqual(last)
  })

  it('updates a linked tab in place and never adds a second entry', () => {
    const first = painted(blank())
    const mapId = savedId('Thursday game', first)
    const store = harness(state([tab('t1', first, { title: 'Thursday game', mapId })]))
    const next = painted(first, 1, 0, 8)
    store.edit(next)
    vi.advanceTimersByTime(500)
    expect(mapNames()).toEqual(['Thursday game'])
    expect(store.active().mapId).toBe(mapId)
    expect(loaded(mapId)).toEqual(next)
    // The link did not change, so nothing retitled the tab.
    expect(store.dispatched.some((action) => action.type === 'tab-link')).toBe(false)
  })

  it('writes an undo', () => {
    const store = harness(state([tab('t1')]))
    const first = painted(store.active().game)
    store.edit(first)
    vi.advanceTimersByTime(500)
    store.edit(painted(first, 1, 0, 8))
    vi.advanceTimersByTime(500)
    expect(loaded(store.active().mapId as string)).not.toEqual(first)
    store.dispatch({ type: 'undo' })
    vi.advanceTimersByTime(500)
    expect(loaded(store.active().mapId as string)).toEqual(first)
  })

  it('writes nothing for a workspace adopted from another document', () => {
    const store = harness(state([tab('t1')]))
    const foreign = painted(blank())
    store.dispatch({
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 't1', game: store.active().game },
        { id: 'theirs', title: 'Their board', game: foreign },
      ],
    })
    expect(store.state().tabs.map((entry) => entry.id)).toEqual(['t1', 'theirs'])
    vi.advanceTimersByTime(2000)
    expect(mapNames()).toEqual([])
  })

  it('leaves a map opened from the library untouched until it is edited', () => {
    const game = painted(blank())
    const mapId = savedId('Thursday game', game)
    const store = harness(state([tab('t1')]))
    const opened = loaded(mapId)
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    store.dispatch({ type: 'tab-add', game: opened, title: 'Thursday game', mapId })
    vi.advanceTimersByTime(2000)
    // Never even scheduled: an opened map is not compared against the library,
    // let alone written back into it.
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    const next = painted(opened, 1, 0, 8)
    store.edit(next)
    vi.advanceTimersByTime(500)
    expect(mapNames()).toEqual(['Thursday game'])
    expect(store.active().mapId).toBe(mapId)
    expect(loaded(mapId)).toEqual(next)
  })

  it('writes an undo back to the state a map was opened with', () => {
    const opened = painted(blank())
    const mapId = savedId('Thursday game', opened)
    const store = harness(state([tab('t1')]))
    store.dispatch({ type: 'tab-add', game: loaded(mapId), title: 'Thursday game', mapId })
    const original = store.active().game
    store.edit(painted(original, 1, 0, 8))
    vi.advanceTimersByTime(500)
    expect(loaded(mapId)).not.toEqual(original)
    store.dispatch({ type: 'undo' })
    vi.advanceTimersByTime(500)
    expect(loaded(mapId)).toEqual(original)
  })

  it('leaves an imported or duplicated board out of the library until it is edited', () => {
    // A tab-add carrying a game but no link: JSON and screenshot imports, and
    // Duplicate, which shares the source tab's game object.
    const store = harness(state([tab('t1', painted(blank()))]))
    const source = store.active().game
    store.dispatch({ type: 'tab-add', game: source, title: 'Copy' })
    vi.advanceTimersByTime(2000)
    expect(mapNames()).toEqual([])
    const next = painted(source, 1, 0, 8)
    store.edit(next)
    vi.advanceTimersByTime(500)
    expect(mapNames()).toEqual(['Copy'])
    expect(loaded(store.active().mapId as string)).toEqual(next)
  })

  it('keeps a pending save on the source tab when it is duplicated mid-debounce', () => {
    const store = harness(state([tab('t1')]))
    const game = painted(store.active().game)
    store.edit(game)
    vi.advanceTimersByTime(100)
    store.dispatch({ type: 'tab-add', game, title: 'Copy' })
    vi.advanceTimersByTime(500)
    expect(mapNames()).toEqual(['t1'])
    expect(store.state().tabs.map((entry) => entry.mapId === null)).toEqual([false, true])
  })

  it('flushes a pending save on pagehide and hands back the link it made', () => {
    const store = harness(state([tab('t1'), tab('t2')]))
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(100)
    const linked = store.autosave.flush()
    expect(mapNames()).toEqual(['t1'])
    expect(store.active().mapId).not.toBeNull()
    // The workspace written on unload has to carry the link, since the
    // dispatch that carries it will never render.
    expect(linked?.map((entry) => entry.mapId)).toEqual([store.active().mapId, null])
    expect(store.autosave.flush()).toBeNull()
    // Nothing is left to fire once the flush has written it.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.advanceTimersByTime(2000)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('reports a failed save once per attempt, not once per keystroke', () => {
    const store = harness(state([tab('t1')]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(100)
    store.edit(painted(store.active().game, 1, 0, 8))
    vi.advanceTimersByTime(100)
    store.edit(painted(store.active().game, 1, -1, 9))
    vi.advanceTimersByTime(1000)
    expect(store.notices()).toEqual([
      { type: 'notice', message: 'Could not save "t1": QuotaExceededError' },
    ])
    expect(store.active().mapId).toBeNull()
    // Not retried on its own: the same write against the same library would
    // only repeat the toast.
    vi.advanceTimersByTime(5000)
    expect(store.notices()).toHaveLength(1)
    // Retried on the next edit, and then it lands.
    setItem.mockRestore()
    const last = painted(store.active().game, 0, 1, 10)
    store.edit(last)
    vi.advanceTimersByTime(500)
    expect(mapNames()).toEqual(['t1'])
    expect(loaded(store.active().mapId as string)).toEqual(last)
  })

  it('writes the last edit of a tab closed inside the debounce', () => {
    // The close prompt that used to catch unsaved work on the way out is gone.
    const store = harness(state([tab('t1'), tab('t2')]))
    const game = painted(store.active().game)
    store.edit(game)
    store.dispatch({ type: 'tab-close', id: 't1' })
    expect(mapNames()).toEqual(['t1'])
    expect(loaded(listMaps().maps[0].id as string)).toEqual(game)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.advanceTimersByTime(2000)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('writes nothing for a tab closed with discard, even inside the debounce', () => {
    // The library row was deleted on purpose; the rescue write for a closing
    // tab would put the map straight back.
    const store = harness(state([tab('t1'), tab('t2')]))
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(1000)
    expect(mapNames()).toEqual(['t1'])
    const mapId = listMaps().maps[0].id as string
    store.edit(painted(store.active().game, 1, 0, 8))
    deleteMap(mapId)
    store.dispatch({ type: 'tab-close', id: 't1', discard: true })
    vi.advanceTimersByTime(2000)
    expect(mapNames()).toEqual([])
  })

  it('retries a failed save when the tab closes, and lands it when the library has room', () => {
    const store = harness(state([tab('t1'), tab('t2')]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const game = painted(store.active().game)
    store.edit(game)
    vi.advanceTimersByTime(1000)
    expect(store.notices()).toHaveLength(1)
    setItem.mockRestore()
    store.dispatch({ type: 'tab-close', id: 't1' })
    expect(mapNames()).toEqual(['t1'])
    expect(loaded(listMaps().maps[0].id as string)).toEqual(game)
    expect(store.notices()).toHaveLength(1)
  })

  it('says so when a closed tab could not be saved on the way out', () => {
    // The close is the last chance: the closed tab held the only copy.
    const store = harness(state([tab('t1'), tab('t2')]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(1000)
    store.dispatch({ type: 'tab-close', id: 't1' })
    expect(store.notices().map((action) => action.message)).toEqual([
      'Could not save "t1": QuotaExceededError',
      'Closed "t1" without its latest changes: QuotaExceededError',
    ])
    setItem.mockRestore()
    expect(mapNames()).toEqual([])
    // Nothing lingers for a tab that is gone.
    vi.advanceTimersByTime(5000)
    expect(store.notices()).toHaveLength(2)
  })

  it('retries a failed save on flush', () => {
    const store = harness(state([tab('t1')]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const game = painted(store.active().game)
    store.edit(game)
    vi.advanceTimersByTime(1000)
    setItem.mockRestore()
    const flushed = store.autosave.flush()
    expect(mapNames()).toEqual(['t1'])
    expect(flushed?.[0].mapId).toBe(listMaps().maps[0].id)
    expect(loaded(listMaps().maps[0].id as string)).toEqual(game)
  })
})
