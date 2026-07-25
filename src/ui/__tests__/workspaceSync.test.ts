// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { adjustHand, newGame } from '../../model/game'
import { WORKSPACE_KEY, saveWorkspace } from '../../persistence/localStorage'
import {
  createWorkspaceSync,
  persistedWorkspace,
  reducer,
  type StoreAction,
  type StoreState,
  type TabState,
} from '../store'

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

/**
 * One browser document: the real sync, plus the two things StoreProvider's
 * effects contribute — arming the pending workspace after every state change,
 * and delivering storage events from other documents.
 */
class Doc {
  state: StoreState
  private sync = createWorkspaceSync((action: StoreAction) => {
    this.state = reducer(this.state, action)
  })

  constructor(tabIds: string[]) {
    this.state = stateOf(tabIds)
    this.sync.arm(persistedWorkspace(this.state.tabs, this.state.activeTabId))
  }

  get ids() {
    return this.state.tabs.map((entry) => entry.id)
  }

  dispatch(action: StoreAction) {
    this.state = reducer(this.state, action)
    this.sync.arm(persistedWorkspace(this.state.tabs, this.state.activeTabId))
  }

  receive(event: Pick<StorageEvent, 'key' | 'newValue'>) {
    this.sync.receive(event)
    this.sync.arm(persistedWorkspace(this.state.tabs, this.state.activeTabId))
  }

  /** The autosave debounce firing. Returns what other documents would receive. */
  flush(): { key: string; newValue: string | null } | null {
    const before = localStorage.getItem(WORKSPACE_KEY)
    const outcome = this.sync.flush()
    if (outcome === 'resynced') {
      // What StoreProvider's resync counter does: re-arm from the reconciled
      // state, so the next debounce writes that instead of what was owed.
      this.sync.arm(persistedWorkspace(this.state.tabs, this.state.activeTabId))
      return null
    }
    const after = localStorage.getItem(WORKSPACE_KEY)
    return after === before ? null : { key: WORKSPACE_KEY, newValue: after }
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
    saveWorkspace(persistedWorkspace(stateOf(OPEN).tabs, OPEN[0]))
  })

  const both = () => [new Doc(OPEN), new Doc(OPEN)] as const

  it('adopts a close without echoing it back', () => {
    // The echo is what used to land inside the other window's debounce; a
    // document that only adopted has nothing of its own to write.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    const written = a.flush()
    expect(written).not.toBeNull()

    b.receive(written!)
    expect(b.ids).toEqual(['t2', 't3', 't4'])
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

  it('reconciles rather than overwrite a blob it never saw', () => {
    // B is frozen (bfcache) through A's write and never gets the event, so its
    // own view is the stale one; writing it would resurrect the closed tab.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    a.flush()

    b.edit('t2')
    expect(b.flush()).toBeNull()
    expect(b.ids).toEqual(['t2', 't3', 't4'])

    const written = b.flush()
    expect(written).not.toBeNull()
    a.receive(written!)
    expect(a.ids).toEqual(['t2', 't3', 't4'])
  })

  it('a document that adopts a close does not write it back on unload', () => {
    // pagehide flushes whatever is pending; for a document that only adopted,
    // that has to be nothing.
    const [a, b] = both()
    a.dispatch({ type: 'tab-close', id: 't1' })
    b.receive(a.flush()!)
    expect(b.flush()).toBeNull()
    expect(localStorage.getItem(WORKSPACE_KEY)).toContain('"t2"')
    expect(localStorage.getItem(WORKSPACE_KEY)).not.toContain('"t1"')
  })
})
