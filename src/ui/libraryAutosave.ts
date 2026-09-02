// Boards save themselves (B7): every edit made in this document writes the tab
// into its library map after a short debounce, and an unlinked tab links itself
// to a new map on its first non-blank edit. A game that arrives with a tab
// (another document's workspace, a map opened from the library, an import, a
// duplicate) never writes on arrival; that tab's first edit here does.

import type { Dispatch } from 'react'
import type { Game } from '../model/game'
import { loadMap, readLibrary } from '../persistence/localStorage'
import { saveTab, savedMap, tabIsDirty } from './boardFiles'
import type { StoreAction, TabState } from './store'

export const AUTOSAVE_DELAY = 500

export interface LibraryAutosave {
  /** Called with the tab set after every commit; arms the debounce per tab. */
  arm(tabs: readonly TabState[]): void
  /**
   * Writes every pending tab now, for pagehide. Returns the tab set with the
   * links those writes made applied, or null when they made none: the
   * dispatches carrying a link cannot render before the document unloads, so
   * the workspace flush that follows has to be handed it.
   */
  flush(): readonly TabState[] | null
  dispose(): void
}

export function createLibraryAutosave(
  dispatch: Dispatch<StoreAction>,
  initialTabs: readonly TabState[],
  delay = AUTOSAVE_DELAY,
): LibraryAutosave {
  // The game identity each tab last saved or arrived with. A tab whose game is
  // any other object has been edited here and owes a write. Games are immutable
  // and replaced wholesale by the reducer, so identity is exact. A tab id with
  // no entry is new to this document, and is baselined at whatever game it
  // arrived with rather than scheduled: that is what keeps adopted, opened,
  // imported and duplicated boards out of the library until they are edited.
  const baseline = new Map<string, Game>(initialTabs.map((tab) => [tab.id, tab.game]))
  // The game each tab last failed to save. Not retried until the tab holds a
  // different game: a write to the same library that just refused this one
  // would only repeat the toast.
  const failed = new Map<string, Game>()
  const timers = new Map<string, number>()
  // Links made by the current flush, for the tab set it returns.
  const flushed = new Map<string, { mapId: string; title: string }>()
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
      flushed.set(id, { mapId: result.id, title: result.name })
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

  // Fires a pending timer now, writing the tab as `tabs` last held it.
  const fire = (id: string, timer: number, tabs: readonly TabState[]) => {
    window.clearTimeout(timer)
    const tab = tabs.find((candidate) => candidate.id === id)
    if (tab !== undefined) save(tab)
    else timers.delete(id)
  }

  return {
    arm(tabs) {
      const open = new Set(tabs.map((tab) => tab.id))
      const previous = latest
      latest = tabs
      // A tab closed inside the debounce still gets its last edit written: the
      // close prompt that used to catch this is gone.
      for (const [id, timer] of [...timers]) {
        if (!open.has(id)) fire(id, timer, previous)
      }
      for (const id of [...baseline.keys()]) {
        if (!open.has(id)) {
          baseline.delete(id)
          failed.delete(id)
        }
      }
      for (const tab of tabs) {
        const known = baseline.get(tab.id)
        if (known === undefined) baseline.set(tab.id, tab.game)
        else if (known !== tab.game && failed.get(tab.id) !== tab.game) schedule(tab.id)
      }
    },
    flush() {
      flushed.clear()
      for (const [id, timer] of [...timers]) fire(id, timer, latest)
      if (flushed.size === 0) return null
      return latest.map((tab) => {
        const link = flushed.get(tab.id)
        return link === undefined ? tab : { ...tab, mapId: link.mapId, title: link.title }
      })
    },
    dispose() {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    },
  }
}
