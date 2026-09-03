// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { MAX_MAPS, deleteMap, listMaps, loadMap, saveMap } from '../../persistence/localStorage'
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

// MAX_MAPS maps m1..m<MAX_MAPS>, each stamped a second after the last, then
// the clock moved past them all so a new save is the warmest entry.
const fillLibrary = (): string[] => {
  const ids = Array.from({ length: MAX_MAPS }, (_, i) => {
    vi.setSystemTime(1000 * (i + 1))
    return savedId(`m${i + 1}`, painted(blank()))
  })
  vi.setSystemTime(1000 * (MAX_MAPS + 2))
  return ids
}

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

  it('closes the board whose map the cap evicted, without a rescue write', () => {
    // MAX_MAPS maps, the oldest of them open in a tab beside a fresh board.
    const ids = fillLibrary()
    const oldest = tab('t1', loaded(ids[0]), { mapId: ids[0] })
    const store = harness(state([oldest, tab('t2')], 't2'))
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(1000)
    expect(store.state().tabs.map((candidate) => candidate.id)).toEqual(['t2'])
    expect(store.dispatched).toContainEqual({ type: 'tab-close', id: 't1', discard: true })
    const names = mapNames()
    expect(names).toHaveLength(MAX_MAPS)
    expect(names).not.toContain('m1')
    expect(names).toContain('t2')
    // Nothing owed for the closed tab: no rescue write lands later.
    vi.advanceTimersByTime(2000)
    expect(mapNames()).toHaveLength(MAX_MAPS)
  })

  it('says how many boards the cap dropped', () => {
    fillLibrary()
    const store = harness(state([tab('t1')]))
    store.edit(painted(store.active().game))
    vi.advanceTimersByTime(1000)
    expect(store.notices()).toEqual([{ type: 'notice', message: `Dropped 1 older board to keep the library at ${MAX_MAPS}` }])
  })

  it('never evicts a map another tab here still owes a write to', () => {
    // The fresh board's first save fires while the cold board's edit is still
    // inside its debounce: the cold map must survive, and its edit must land.
    const ids = fillLibrary()
    const cold = tab('t1', loaded(ids[0]), { mapId: ids[0] })
    const store = harness(state([cold, tab('t2')], 't2'))
    store.edit(painted(store.active().game))
    store.dispatch({ type: 'tab-select', id: 't1' })
    const coldEdit = painted(cold.game, 1, 0, 8)
    store.edit(coldEdit)
    vi.advanceTimersByTime(1000)
    expect(store.state().tabs.map((candidate) => candidate.id)).toEqual(['t1', 't2'])
    const names = mapNames()
    expect(names).toHaveLength(MAX_MAPS)
    expect(names).toContain('m1')
    expect(names).not.toContain('m2')
    expect(loaded(ids[0])).toEqual(coldEdit)
  })

  it('shields a closing tab from the eviction another closing tab causes', () => {
    // Two tabs leave together (another window's write), both owing: the fresh
    // one's save must not evict the cold one's map out from under its write.
    const ids = fillLibrary()
    const fresh = tab('t2')
    const cold = tab('t1', loaded(ids[0]), { mapId: ids[0] })
    const coldEdit = painted(cold.game, 1, 0, 8)
    const store = harness(state([fresh, cold], 't2'))
    store.edit(painted(fresh.game))
    store.dispatch({ type: 'tab-select', id: 't1' })
    store.edit(coldEdit)
    store.dispatch({ type: 'workspace-adopt', tabs: [{ id: 't3', title: 't3', game: blank() }] })
    expect(store.state().tabs.map((candidate) => candidate.id)).toEqual(['t3'])
    const names = mapNames()
    expect(names).toHaveLength(MAX_MAPS)
    expect(names).toContain('m1')
    expect(names).not.toContain('m2')
    expect(names).toContain('t2')
    expect(loaded(ids[0])).toEqual(coldEdit)
  })

  it('drops an evicted tab from the tab set a pagehide flush hands back', () => {
    const ids = fillLibrary()
    const tabs = [tab('t1', loaded(ids[0]), { mapId: ids[0] }), tab('t2')]
    // React cannot render a pagehide dispatch, so the autosave never sees the
    // close it asks for: the tab set it returns is the only correction, and
    // the closed tab must not be written on the way out of the same loop.
    const dispatched: StoreAction[] = []
    const autosave = createLibraryAutosave((action) => dispatched.push(action), tabs)
    autosave.arm([tabs[0], { ...tabs[1], game: painted(tabs[1].game) }])
    expect(autosave.flush()?.map((entry) => entry.id)).toEqual(['t2'])
    expect(dispatched).toContainEqual({ type: 'tab-close', id: 't1', discard: true })
    const names = mapNames()
    expect(names).toHaveLength(MAX_MAPS)
    expect(names).not.toContain('m1')
    expect(names).toContain('m2')
    expect(names).not.toContain('t1')
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
