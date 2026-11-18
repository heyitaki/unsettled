import { useMemo } from 'react'
import {
  deleteMap,
  deleteMapAt,
  type ListedMap,
  listMaps,
  loadMap,
  markMapOpened,
  readLibrary,
  renameMap,
} from '../persistence/localStorage'
import type { Game } from '../model/game'
import { loadWarnings } from './boardFiles'
import { useStore } from './store'

/**
 * The saved-map library as both trees see it: the listing, cached on the
 * store's revision counter, and the open, delete and rename paths. They address
 * an entry by id; delete falls back to its position when it has none. Read by
 * LibraryLists, which MapsPanel and the phone's Maps screen both render, so
 * there is one open path and one delete path. Sorting is the caller's:
 * `sortMaps` in library.ts over `listed.maps`.
 *
 * The one list in the Library shows every map beside the boards not yet saved,
 * so a tap on a map is a plain switch when its board is already loaded and a
 * load otherwise, with nothing said either way unless the load raised warnings.
 */
export function useLibrary() {
  const { state, dispatch } = useStore()
  // Listing validates every stored board, so it is re-read only when the
  // library actually changed rather than on every render of every panel. The
  // revision is the cache key for a localStorage read React cannot observe.
  const listed = useMemo(() => {
    void state.mapsRevision
    return listMaps()
  }, [state.mapsRevision])
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const refresh = () => dispatch({ type: 'maps-changed', library: readLibrary() })
  const addressable = (map: ListedMap): string | null => {
    if (map.id === null) notice('This map entry is malformed and cannot be opened or renamed')
    return map.id
  }
  // The map's tab is the one linked to its id. A tab that merely shares the
  // name is a different board and is left alone.
  const tabOf = (mapKey: string) => state.tabs.find((tab) => tab.mapId === mapKey)
  /** Opens or switches to the map. Returns false when it refused, with the reason already toasted. */
  const openMap = (map: ListedMap): boolean => {
    const mapKey = addressable(map)
    if (mapKey === null) return false
    // Before the storage read: a board already loaded needs nothing from it.
    // The switch still counts as opened, or the "Last opened" sort would only
    // know about cold loads.
    const existing = tabOf(mapKey)
    if (existing) {
      // The row of the board already on screen: nothing to switch, and the
      // stamp write would only rebuild the listing and wake other windows.
      if (existing.id === state.activeTabId) return true
      markMapOpened(mapKey)
      refresh()
      dispatch({ type: 'tab-select', id: existing.id })
      return true
    }
    const loaded = loadMap(mapKey)
    if (!loaded.ok) {
      notice(loaded.errors.join(', '))
      return false
    }
    markMapOpened(mapKey)
    refresh()
    dispatch({ type: 'tab-add', game: loaded.game, title: map.name, mapId: mapKey })
    const warnings = loadWarnings(loaded.game.board)
    if (warnings !== null) notice(`Loaded "${map.name}" ${warnings}`)
    return true
  }
  /**
   * The game a hover over the map's row previews: its tab's live game when it
   * is loaded, else the stored copy, or null when it has none that reads.
   */
  const previewOf = (map: ListedMap): Game | null => {
    if (map.id === null || !map.valid) return null
    const tab = tabOf(map.id)
    if (tab) return tab.game
    const loaded = loadMap(map.id)
    return loaded.ok ? loaded.game : null
  }
  /**
   * Deletes the map and drops the board loaded from it, which is the same row.
   * The board goes only once the delete has landed: a refused write leaves the
   * map, and must leave the board and its pending edit with it.
   */
  const deleteSavedMap = (map: ListedMap) => {
    // A row with no id (an old storage shape, or junk) or no name is addressed
    // by its position in the store, and no tab can be linked to it.
    const mapKey = map.synthetic === true ? null : map.id
    // The position is only good while storage still holds the blob this
    // listing was built from, which listMaps answers by identity.
    if (mapKey === null && listMaps() !== listed) {
      notice('The library changed, try again')
      refresh()
      return
    }
    const result = mapKey === null ? deleteMapAt(map) : deleteMap(mapKey)
    if (result.ok && mapKey !== null) {
      const existing = tabOf(mapKey)
      if (existing) dispatch({ type: 'tab-close', id: existing.id, discard: true })
    }
    notice(result.ok ? `Deleted "${map.name}"` : result.error)
    refresh()
  }
  /**
   * Renames a saved map in place. The library refresh retitles any tab linked
   * to it, so the header and the board list follow without a tab-rename.
   * Returns whether the new name took.
   */
  const renameSavedMap = (map: ListedMap, requested: string): boolean => {
    const next = requested.trim()
    if (next.length === 0 || next === map.name) return false
    const mapKey = addressable(map)
    if (mapKey === null) return false
    const result = renameMap(mapKey, next)
    if (!result.ok) notice(result.error)
    refresh()
    return result.ok
  }
  return { listed, openMap, previewOf, deleteSavedMap, renameSavedMap }
}
