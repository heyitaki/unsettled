// Boards save themselves (B7): every edit made in this document writes the tab
// into its library map after a short debounce, and an unlinked tab links itself
// to a new map on its first non-blank edit. A game that arrives with a tab
// (another document's workspace, a map opened from the library, an import, a
// duplicate) never writes on arrival; that tab's first edit here does.

import type { Dispatch } from 'react'
import type { Game } from '../model/game'
import { MAX_MAPS, loadMap, readLibrary } from '../persistence/localStorage'
import { saveTab, savedMap, tabIsDirty } from './boardFiles'
import type { StoreAction, TabState } from './store'
import type { ReportSave } from './saveStatus'

export const AUTOSAVE_DELAY = 500

export interface LibraryAutosave {
  /** Called with the tab set after every commit; arms the debounce per tab. */
  arm(tabs: readonly TabState[]): void
  /**
   * Writes every pending tab now, for pagehide. Returns the tab set as those
   * writes left it, with the links they made applied and the tabs the cap
   * closed removed, or null when they changed nothing: the dispatches
   * carrying a link or a close cannot render before the document unloads, so
   * the workspace flush that follows has to be handed the result.
   */
  flush(): readonly TabState[] | null
  /**
   * Drops everything owed for a tab about to be closed with `discard`: its
   * map was deleted on purpose, or the cap evicted it, so the closing save
   * that normally rescues a closed tab's last edit must not land it back in
   * the library as a new map.
   */
  forget(id: string): void
  dispose(): void
}

export function createLibraryAutosave(
  dispatch: Dispatch<StoreAction>,
  initialTabs: readonly TabState[],
  delay = AUTOSAVE_DELAY,
  report: ReportSave = () => {},
): LibraryAutosave {
  // The game identity each tab last saved or arrived with. A tab whose game is
  // any other object has been edited here and owes a write. Games are immutable
  // and replaced wholesale by the reducer, so identity is exact. A tab id with
  // no entry is new to this document, and is baselined at whatever game it
  // arrived with rather than scheduled: that is what keeps adopted, opened,
  // imported and duplicated boards out of the library until they are edited.
  const baseline = new Map<string, Game>(initialTabs.map((tab) => [tab.id, tab.game]))
  // The game each tab last failed to save. Not retried until the tab holds a
  // different game, closes, or the document unloads: a write to the same
  // library that just refused this one would only repeat the toast, but a
  // close or unload is the last chance before the tab's copy is gone.
  const failed = new Map<string, Game>()
  const closedFailures = new Map<string, TabState>()
  const timers = new Map<string, number>()
  // Links made by the current flush, for the tab set it returns.
  const flushed = new Map<string, { mapId: string; title: string }>()
  // Tabs the current flush closed because the cap evicted their maps; the
  // workspace written after it must not carry them, or a reload would revive
  // each as an unsaved board that re-saves itself past the cap.
  const closed = new Set<string>()
  let latest: readonly TabState[] = initialTabs

  // `tabs` is the set the write is made from: `latest`, or the previous set
  // when a closing tab is written on its way out. `closing` names the failure
  // for what it is: the tab is gone once the dispatch renders, so "could not
  // save" would suggest a retry that cannot happen.
  const save = (tab: TabState, tabs: readonly TabState[], closing = false) => {
    const { id } = tab
    timers.delete(id)
    // Nothing to write for a blank unlinked board, or for a linked one whose
    // map already holds this content: an undo back to the saved state, or a
    // restored tab, would otherwise bump the map's modified time for nothing.
    const saved = tab.mapId === null ? { linked: false as const } : savedMap(loadMap(tab.mapId))
    if (!tabIsDirty(tab.game, saved)) {
      baseline.set(id, tab.game)
      failed.delete(id)
      closedFailures.delete(id)
      report(`library:${id}`, null)
      return
    }
    // Maps other tabs here still owe a write to are kept out of the cap's
    // reach: evicted, each would come back as a new map on that write, and an
    // edit still inside its debounce would go with the closed tab. Over `tabs`
    // rather than `latest`, so two tabs closing together cover each other.
    const owed = owing()
    const keep = new Set<string>()
    for (const other of tabs) {
      if (other.id !== id && other.mapId !== null && owed.has(other.id)) keep.add(other.mapId)
    }
    const result = saveTab(tab, keep)
    if (!result.ok) {
      // Once per attempt: the debounce has already folded a burst of edits into
      // this one write, and the next edit is what retries it.
      failed.set(id, tab.game)
      if (closing) closedFailures.set(id, tab)
      report(`library:${id}`, { message: `Could not save "${tab.title}": ${result.error}`, tab: {
        id: tab.id, title: tab.title, game: tab.game, ...(tab.mapId === null ? {} : { mapId: tab.mapId }),
      } })
      dispatch({
        type: 'notice',
        message: closing
          ? `Closed "${tab.title}" without its latest changes: ${result.error}`
          : `Could not save "${tab.title}": ${result.error}`,
      })
      return
    }
    // Before dispatching: the commits below call back into arm with this game.
    baseline.set(id, tab.game)
    failed.delete(id)
    closedFailures.delete(id)
    report(`library:${id}`, null)
    if (result.id !== tab.mapId) {
      flushed.set(id, { mapId: result.id, title: result.name })
      dispatch({ type: 'tab-link', id, mapId: result.id, title: result.name })
    }
    // A board whose map the cap just dropped goes with it: left open, it
    // would list as unsaved and re-save itself into a 51st map on its next
    // edit. Forgotten first, so its own closing rescue cannot do the same.
    if (result.evicted !== undefined) {
      // Only a tab owing nothing can be here: `keep` shielded the rest.
      const gone = new Set(result.evicted)
      for (const other of latest) {
        if (other.mapId === null || !gone.has(other.mapId)) continue
        forget(other.id)
        closed.add(other.id)
        dispatch({ type: 'tab-close', id: other.id, discard: true })
      }
      // Said out loud: a library that was already over the cap loses many at
      // once here, and even one board leaving on its own deserves a word.
      const count = result.evicted.length
      dispatch({
        type: 'notice',
        message: `Dropped ${count} older board${count === 1 ? '' : 's'} to keep the library at ${MAX_MAPS}`,
      })
    }
    dispatch({ type: 'maps-changed', library: readLibrary() })
  }

  const forget = (id: string) => {
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.delete(id)
    failed.delete(id)
    closedFailures.delete(id)
    report(`library:${id}`, null)
    baseline.delete(id)
  }

  const schedule = (id: string) => {
    const pending = timers.get(id)
    if (pending !== undefined) window.clearTimeout(pending)
    timers.set(id, window.setTimeout(() => {
      const tab = latest.find((candidate) => candidate.id === id)
      if (tab !== undefined) save(tab, latest)
    }, delay))
  }

  // Writes a tab now, as `tabs` last held it, cancelling any pending timer.
  const fire = (id: string, tabs: readonly TabState[], closing = false) => {
    const timer = timers.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    const tab = tabs.find((candidate) => candidate.id === id)
    if (tab !== undefined) save(tab, tabs, closing)
    else timers.delete(id)
  }
  // Every tab owing a write: one inside its debounce, or one whose last save
  // failed and has not been edited since.
  const owing = () => new Set([...timers.keys(), ...failed.keys()])

  return {
    arm(tabs) {
      const open = new Set(tabs.map((tab) => tab.id))
      const previous = latest
      latest = tabs
      // A tab closed inside the debounce, or after a save that failed, still
      // gets its last edit written: the close prompt that used to catch both
      // is gone, and the closing tab holds the only copy.
      for (const id of owing()) {
        if (!open.has(id)) fire(id, previous, true)
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
      closed.clear()
      for (const tab of [...closedFailures.values()]) save(tab, latest, true)
      for (const id of owing()) fire(id, latest)
      if (flushed.size === 0 && closed.size === 0) return null
      return latest
        .filter((tab) => !closed.has(tab.id))
        .map((tab) => {
          const link = flushed.get(tab.id)
          return link === undefined ? tab : { ...tab, mapId: link.mapId, title: link.title }
        })
    },
    forget,
    dispose() {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    },
  }
}
