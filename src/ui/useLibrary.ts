import { useMemo } from 'react'
import {
  deleteMap,
  type ListedMap,
  listMaps,
  loadMap,
  markMapOpened,
  migrateMapIds,
  readLibrary,
  renameMap,
} from '../persistence/localStorage'
import { loadedNotice } from './boardFiles'
import { useStore } from './store'

/**
 * The saved-map library as both trees see it: the listing, cached on the
 * store's revision counter, and the open, delete and rename paths that address
 * an entry by id. Shared by MapsPanel and the phone's Maps screen so there is
 * one open path and one delete path. Sorting is the caller's: `sortMaps` in
 * library.ts over `listed.maps`.
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
  /**
   * An entry with no id is one the startup migration could not stamp: its write
   * failed, or it has no name to be addressed by. Retry on demand so a
   * transient failure heals rather than leaving the row permanently unopenable
   * and undeletable. Resolved by position, never by name: matching on a name
   * is what this whole mechanism replaced.
   */
  const addressable = (map: ListedMap): string | null => {
    if (map.id !== null) return map.id
    const result = migrateMapIds()
    if (!result.ok) {
      notice(`Could not upgrade the map library: ${result.error}`)
      return null
    }
    refresh()
    const stamped = listMaps().maps[map.index]
    // Another document can have added or removed rows since this list was
    // rendered, sliding that position onto a different map. Refuse rather than
    // address the wrong one; the refresh above re-renders the row with its id.
    if (stamped === undefined || stamped.name !== map.name) {
      notice('The library changed in another window; open it again')
      return null
    }
    if (stamped.id === null) notice('This map entry is malformed and cannot be opened or deleted')
    return stamped.id
  }
  /** Opens or switches to the map. Returns false when it refused, with the reason already toasted. */
  const openMap = (map: ListedMap): boolean => {
    const mapKey = addressable(map)
    if (mapKey === null) return false
    const loaded = loadMap(mapKey)
    if (!loaded.ok) {
      notice(loaded.errors.join(', '))
      return false
    }
    markMapOpened(mapKey)
    refresh()
    // The map's tab is the one linked to its id. A tab that merely shares the
    // name is a different board and is left alone.
    const existing = state.tabs.find((tab) => tab.mapId === mapKey)
    if (existing) {
      dispatch({ type: 'tab-select', id: existing.id })
      notice(`Switched to "${map.name}"`)
      return true
    }
    dispatch({ type: 'tab-add', game: loaded.game, title: map.name, mapId: mapKey })
    notice(loadedNotice(`Loaded "${map.name}"`, loaded.game.board))
    return true
  }
  const deleteSavedMap = (map: ListedMap) => {
    const mapKey = addressable(map)
    if (mapKey === null) return
    const result = deleteMap(mapKey)
    notice(result.ok ? `Deleted "${map.name}"` : result.error)
    refresh()
  }
  /**
   * Renames a saved map in place. The library refresh retitles any tab linked
   * to it, so the header and the open-boards list follow without a tab-rename.
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
  return { listed, openMap, deleteSavedMap, renameSavedMap }
}
