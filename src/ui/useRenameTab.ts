import { readLibrary, renameMap } from '../persistence/localStorage'
import { type StoreAction, type TabState, useStore } from './store'

/**
 * The board rename rule, shared by both trees through the library's open-boards list.
 * Returns the title the tab carries afterwards, or null when the rename was
 * refused and said so, so a caller never reports a success over that message.
 */
export function renameTab(tab: TabState, requested: string, dispatch: (action: StoreAction) => void): string | null {
  const next = requested.trim()
  // A blank field cancels the rename, leaving the board named as it was.
  if (next.length === 0) return tab.title
  // Only a real link may rename a map: titles carry no identity, so a
  // same-named tab that owns nothing cannot rename someone else's map.
  if (next !== tab.title && tab.mapId !== null) {
    const result = renameMap(tab.mapId, next)
    const library = readLibrary()
    const gone = library.readable && !library.maps.some((map) => map.id === tab.mapId)
    // A map deleted in another window must not block a local rename: unlink
    // and let the tab be renamed, rather than refusing over a map the user
    // cannot see and cannot act on.
    if (!result.ok && !gone) {
      dispatch({ type: 'notice', message: result.error })
      return null
    }
    dispatch({ type: 'maps-changed', library })
  }
  dispatch({ type: 'tab-rename', id: tab.id, title: next })
  return next
}

export function useRenameTab() {
  const { dispatch } = useStore()
  return (tab: TabState, requested: string) => renameTab(tab, requested, dispatch)
}
