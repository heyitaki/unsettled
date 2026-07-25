// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { adjustHand, newGame } from '../../model/game'
import {
  WORKSPACE_KEY,
  saveWorkspace,
  type PersistedWorkspace,
} from '../../persistence/localStorage'
import { reducer, type StoreAction, type StoreState, type TabState } from '../store'
import { createWorkspaceSync, persistedWorkspace } from '../workspaceSync'

const game = () => newGame(createBoard('standard4'))

const tab = (id: string): TabState => ({
  id,
  title: id,
  game: game(),
  past: [],
  future: [],
  activePlayerId: 'aki',
  mapId: null,
})

const stateOf = (ids: string[]): StoreState => ({
  tabs: ids.map(tab),
  activeTabId: ids[0],
  tool: { kind: 'tile', tile: 'wood' },
  notice: null,
  noticeSeq: 0,
  highlight: null,
  mapsRevision: 0,
})

// Writes to the workspace key, counted rather than inferred from the bytes: a
// write of identical bytes and a skipped write leave storage the same, and the
// whole point of skipping is that the other documents get no event.
let writes = 0
const nativeSetItem = Storage.prototype.setItem

/**
 * One browser document: the real sync, plus the three things StoreProvider's
 * effects contribute — arming on every commit, delivering storage events, and
 * the debounce that flushes what is owed.
 */
class Doc {
  state: StoreState
  private sync = createWorkspaceSync((action: StoreAction) => {
    this.state = reducer(this.state, action)
  })
  // What the debounce closed over, which StoreProvider passes to flush() so a
  // superseded timer writes nothing.
  private armed: PersistedWorkspace | null = null

  constructor(tabIds: string[]) {
    this.state = stateOf(tabIds)
    this.commit()
  }

  get ids() {
    return this.state.tabs.map((entry) => entry.id)
  }

  /** StoreProvider's arming layout effect, which runs on every commit. */
  private commit() {
    this.armed = persistedWorkspace(this.state.tabs)
    this.sync.arm(this.armed)
  }

  dispatch(action: StoreAction) {
    this.state = reducer(this.state, action)
    this.commit()
  }

  receive(event: Pick<StorageEvent, 'key' | 'newValue'>) {
    this.sync.receive(event)
    this.commit()
  }

  /**
   * The autosave debounce firing. Returns what other documents would receive.
   * A deferred flush does NOT re-arm here: StoreProvider bumps its resync
   * counter, and the re-arm only happens on the render that follows — see
   * rearm(), which tests call explicitly so that gap stays visible.
   */
  flush(): { key: string; newValue: string | null } | null {
    const before = writes
    this.deferred = this.sync.flush(this.armed ?? undefined) === 'deferred'
    if (writes === before) return null
    return { key: WORKSPACE_KEY, newValue: localStorage.getItem(WORKSPACE_KEY) }
  }

  deferred = false

  /** The re-render StoreProvider's resync counter forces after a deferred flush. */
  rearm() {
    this.commit()
  }

  /**
   * A debounce firing for a workspace a newer commit already replaced.
   * persistedWorkspace builds a fresh object, so this is never the armed one.
   */
  flushSuperseded() {
    this.sync.flush(persistedWorkspace(this.state.tabs))
  }

  edit(tabId: string) {
    const target = this.state.tabs.find((entry) => entry.id === tabId)
    if (!target) throw new Error(`no tab ${tabId}`)
    this.dispatch({ type: 'tab-select', id: tabId })
    this.dispatch({ type: 'commit-game', game: adjustHand(target.game, 'aki', 'wood', 1) })
  }
}

/**
 * Two documents on one workspace key. Every bug this protocol has had has been
 * a race between them, and a race is only visible with both halves running.
 */
describe('two documents on one workspace', () => {
  const OPEN = ['t1', 't2', 't3', 't4']

  beforeEach(() => {
    localStorage.clear()
    saveWorkspace(persistedWorkspace(stateOf(OPEN).tabs))
    writes = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === WORKSPACE_KEY) writes += 1
      nativeSetItem.call(this, key, value)
    })
  })

  afterEach(() => vi.restoreAllMocks())

  const both = () => [new Doc(OPEN), new Doc(OPEN)] as const

  it('adopts a close without echoing it back', () => {
    // The echo is what used to land inside the other window's debounce; a
    // document that only adopted has nothing of its own to write, and must not
    // fire a storage event saying so.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    const written = a.flush()
    expect(written).not.toBeNull()

    b.receive(written!)
    expect(b.ids).toEqual(['t2', 't3', 't4'])
    const before = writes
    expect(b.flush()).toBeNull()
    expect(writes).toBe(before)
  })

  it('does not echo just because the two windows look at different tabs', () => {
    // Which board a window has in front is its own business and is not in the
    // shared blob, so two windows on different tabs still agree byte-for-byte
    // and the skip holds. While it was shared, every adoption was answered with
    // a rewrite of every board — the traffic that put the two windows'
    // debounces in phase in the first place.
    const [a, b] = both()
    b.dispatch({ type: 'tab-select', id: 't3' })
    a.dispatch({ type: 'tab-close', id: 't1' })

    b.receive(a.flush()!)
    expect(b.ids).toEqual(['t2', 't3', 't4'])
    expect(b.state.activeTabId).toBe('t3')
    expect(b.flush()).toBeNull()
  })

  it('keeps a close whose write is still in flight', () => {
    // The report: closing tabs in quick succession while a second window is
    // open, and watching them come back one write later.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    b.receive(a.flush()!)

    a.dispatch({ type: 'tab-close', id: 't2' })
    // B, which has not heard about t2 yet, writes a blob that still lists it.
    b.edit('t3')
    a.receive(b.flush()!)
    expect(a.ids).toEqual(['t3', 't4'])

    b.receive(a.flush()!)
    expect(b.ids).toEqual(['t3', 't4'])
  })

  it('closing every tab leaves the blank replacement alone', () => {
    const [a, b] = both()
    for (const id of OPEN) a.dispatch({ type: 'tab-close', id })
    const blank = a.ids[0]
    b.edit('t1')
    a.receive(b.flush()!)
    expect(a.ids).toEqual([blank])

    b.receive(a.flush()!)
    expect(b.ids).toEqual([blank])
  })

  it('a write that stands down still refuses a tab closed here', () => {
    // The standing-down document is the one MOST likely to be holding work the
    // incoming blob predates, so this is the adoption that can least afford to
    // forget it: B never saw A's write, so its own flush reconciles — and must
    // not take B's close back with it.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    a.flush()

    b.dispatch({ type: 'tab-close', id: 't2' })
    expect(b.flush()).toBeNull()
    expect(b.deferred).toBe(true)
    expect(b.ids).toEqual(['t3', 't4'])

    b.rearm()
    a.receive(b.flush()!)
    expect(a.ids).toEqual(['t3', 't4'])
  })

  it('a write that stands down keeps a tab opened here', () => {
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    a.flush()

    b.dispatch({ type: 'tab-add', id: 't9', title: 't9' })
    expect(b.flush()).toBeNull()
    expect(b.ids).toEqual(['t2', 't3', 't4', 't9'])

    b.rearm()
    a.receive(b.flush()!)
    expect(a.ids).toEqual(['t2', 't3', 't4', 't9'])
  })

  it('reconciles rather than overwrite a blob it never saw', () => {
    // B is frozen (bfcache) through A's write and never gets the event, so its
    // own view is the stale one; writing it would resurrect the closed tab.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    a.flush()

    b.edit('t2')
    expect(b.flush()).toBeNull()
    expect(b.ids).toEqual(['t2', 't3', 't4'])

    b.rearm()
    const written = b.flush()
    expect(written).not.toBeNull()
    a.receive(written!)
    expect(a.ids).toEqual(['t2', 't3', 't4'])
  })

  it('a failed write leaves the close owed rather than forgotten', () => {
    // Quota is reachable here: whole serialized games, rewritten every 500ms.
    // The write is lost, but the knowledge that the tab was closed must not be,
    // or the next incoming blob puts it back.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    const quota = new Error('QuotaExceededError')
    vi.mocked(Storage.prototype.setItem).mockImplementationOnce(() => {
      throw quota
    })
    expect(a.flush()).toBeNull()
    expect(a.state.notice).toContain('Autosave failed')

    // B still lists t1, because A never managed to say otherwise.
    b.edit('t2')
    a.receive(b.flush()!)
    expect(a.ids).not.toContain('t1')
  })

  it('a superseded debounce writes nothing', () => {
    // A timer whose workspace a newer commit already replaced: the newer one
    // has its own timer, and writing the older would undo the newer edit.
    const [a] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    a.flushSuperseded()
    expect(writes).toBe(0)
    // ...and what was owed is still owed.
    expect(a.flush()).not.toBeNull()
    expect(writes).toBe(1)
  })
})
