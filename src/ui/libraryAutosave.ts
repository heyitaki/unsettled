// Boards save themselves (B7): every edit made in this document writes the tab
// into its library map after a short debounce, and an unlinked tab links itself
// to a new map on its first non-blank edit. Adopting another document's
// workspace never writes; that document's own autosave does.

import type { Dispatch } from 'react'
import type { Game } from '../model/game'
import { loadMap, readLibrary } from '../persistence/localStorage'
import { saveTab, savedMap, tabIsDirty } from './boardFiles'
import type { StoreAction, TabState } from './store'

export const AUTOSAVE_DELAY = 500

export interface LibraryAutosave {
  /** Sees every action before the reducer does, to tell adopted games apart. */
  observe(action: StoreAction): void
  /** Called with the tab set after every commit; arms the debounce per tab. */
  arm(tabs: readonly TabState[]): void
  /** Writes every pending tab now, for pagehide. */
  flush(): void
  dispose(): void
}

export function createLibraryAutosave(
  dispatch: Dispatch<StoreAction>,
  initialTabs: readonly TabState[],
  delay = AUTOSAVE_DELAY,
): LibraryAutosave {
  // The game identity each tab last saved, adopted or opened with. A tab whose
  // game is any other object has been edited here and owes a write. Games are
  // immutable and replaced wholesale by the reducer, so identity is exact.
  const baseline = new Map<string, Game>(initialTabs.map((tab) => [tab.id, tab.game]))
  // Games that arrived from storage rather than from an edit: another
  // document's workspace, or a map opened from the library. Keyed by the object
  // the reducer will install, so no flag has to be cleared after a dispatch the
  // reducer may have ignored.
  const adopted = new WeakSet<Game>()
  // The game each tab last failed to save. Not retried until the tab holds a
  // different game: a write to the same library that just refused this one
  // would only repeat the toast.
  const failed = new Map<string, Game>()
  const timers = new Map<string, number>()
  let latest: readonly TabState[] = initialTabs

  const save = (tab: TabState) => {
    const { id } = tab
    timers.delete(id)
    // Nothing to write for a blank unlinked board, or for a linked one whose
    // map already holds this content: an undo back to the saved state, or a
    // restored tab, would otherwise bump the map's modified time for nothing.
    const saved = tab.mapId === null ? { linked: false as const } : savedMap(loadMap(tab.mapId))
    if (!tabIsDirty(tab.game, saved)) {
      baseline.set(id, tab.game)
      return
    }
    const result = saveTab(tab)
    if (!result.ok) {
      // Once per attempt: the debounce has already folded a burst of edits into
      // this one write, and the next edit is what retries it.
      failed.set(id, tab.game)
      dispatch({ type: 'notice', message: `Could not save "${tab.title}": ${result.error}` })
      return
    }
    // Before dispatching: the commits below call back into arm with this game.
    baseline.set(id, tab.game)
    failed.delete(id)
    if (result.id !== tab.mapId) {
      dispatch({ type: 'tab-link', id, mapId: result.id, title: result.name })
    }
    dispatch({ type: 'maps-changed', library: readLibrary() })
  }

  const schedule = (id: string) => {
    const pending = timers.get(id)
    if (pending !== undefined) window.clearTimeout(pending)
    timers.set(id, window.setTimeout(() => {
      const tab = latest.find((candidate) => candidate.id === id)
      if (tab !== undefined) save(tab)
    }, delay))
  }

  return {
    observe(action) {
      if (action.type === 'workspace-adopt') {
        for (const tab of action.tabs) adopted.add(tab.game)
      } else if (action.type === 'tab-add' && action.mapId !== undefined && action.game !== undefined) {
        adopted.add(action.game)
      }
    },
    arm(tabs) {
      const open = new Set(tabs.map((tab) => tab.id))
      const previous = latest
      latest = tabs
      // A tab closed inside the debounce still gets its last edit written: the
      // close prompt that used to catch this is gone.
      for (const [id, timer] of [...timers]) {
        if (open.has(id)) continue
        window.clearTimeout(timer)
        const tab = previous.find((candidate) => candidate.id === id)
        if (tab !== undefined) save(tab)
        else timers.delete(id)
      }
      for (const id of [...baseline.keys()]) {
        if (!open.has(id)) {
          baseline.delete(id)
          failed.delete(id)
        }
      }
      for (const tab of tabs) {
        if (adopted.has(tab.game)) {
          baseline.set(tab.id, tab.game)
          const pending = timers.get(tab.id)
          if (pending !== undefined) {
            window.clearTimeout(pending)
            timers.delete(tab.id)
          }
        } else if (baseline.get(tab.id) !== tab.game && failed.get(tab.id) !== tab.game) {
          schedule(tab.id)
        }
      }
    },
    flush() {
      for (const [id, timer] of [...timers]) {
        window.clearTimeout(timer)
        const tab = latest.find((candidate) => candidate.id === id)
        if (tab !== undefined) save(tab)
        else timers.delete(id)
      }
    },
    dispose() {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    },
  }
}
