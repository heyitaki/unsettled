import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  deleteMap,
  type ListedMap,
  listMaps,
  loadMap,
  markMapOpened,
  migrateMapIds,
  readLibrary,
} from '../persistence/localStorage'
import { loadedNotice } from './boardFiles'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore } from './store'

type SortKey = 'name' | 'modifiedAt' | 'createdAt' | 'openedAt'

const SORT_LABEL: Record<Exclude<SortKey, 'name'>, string> = {
  modifiedAt: 'Modified',
  createdAt: 'Created',
  openedAt: 'Opened',
}

// The menu's own labels, keyed by every SortKey so adding a key is a compile
// error rather than a blank sort trigger at runtime. Declaration order is menu
// order.
const SORT_MENU_LABEL: Record<SortKey, string> = {
  modifiedAt: 'Last modified',
  createdAt: 'Created',
  openedAt: 'Last opened',
  name: 'Name',
}

const SORT_OPTIONS: readonly { value: SortKey; label: string }[] =
  (Object.keys(SORT_MENU_LABEL) as SortKey[]).map((value) => ({ value, label: SORT_MENU_LABEL[value] }))

// Compact "3m ago" / "2d ago" so a row's timestamp fits the narrow rail.
function relativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 45) return 'just now'
  const units: [number, string][] = [
    [60, 'm'],
    [3600, 'h'],
    [86400, 'd'],
    [604800, 'w'],
  ]
  let value = seconds
  let suffix = 's'
  for (const [size, label] of units) {
    if (seconds < size) break
    value = Math.floor(seconds / size)
    suffix = label
  }
  return `${value}${suffix} ago`
}

export function MapsPanel() {
  const { state, dispatch } = useStore()
  const { mapId } = activeTab(state)
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  // Listing validates every stored board, so it is re-read only when the
  // library actually changed rather than on every render of every panel. The
  // revision is the cache key for a localStorage read React cannot observe.
  const listed = useMemo(() => {
    void state.mapsRevision
    return listMaps()
  }, [state.mapsRevision])
  const sortedMaps = useMemo(() => [...listed.maps].sort((left, right) => {
    if (sortKey === 'name') return left.name.localeCompare(right.name)
    const leftTimestamp = typeof left[sortKey] === 'number' ? left[sortKey] : -Infinity
    const rightTimestamp = typeof right[sortKey] === 'number' ? right[sortKey] : -Infinity
    if (leftTimestamp === rightTimestamp) return 0
    return rightTimestamp > leftTimestamp ? 1 : -1
  }), [listed, sortKey])
  const refresh = () => dispatch({ type: 'maps-changed', library: readLibrary() })
  /**
   * An entry with no id is one the startup migration could not stamp: its write
   * failed, or it has no name to be addressed by. Retry on demand so a
   * transient failure heals rather than leaving the row permanently unopenable
   * and undeletable. Resolved by position, never by name — matching on a name
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
      notice('The library changed in another window — open it again')
      return null
    }
    if (stamped.id === null) notice('This map entry is malformed and cannot be opened or deleted')
    return stamped.id
  }
  // Fade whichever end of the scrollable map list still hides cut-off rows,
  // mirroring the tab strip's edge masks.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [fades, setFades] = useState({ top: false, bottom: false })
  const syncFades = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFades((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [])
  useLayoutEffect(syncFades, [syncFades, sortedMaps.length])
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const openMap = (map: ListedMap) => {
    const mapKey = addressable(map)
    if (mapKey === null) return
    const loaded = loadMap(mapKey)
    if (!loaded.ok) {
      notice(loaded.errors.join(', '))
      return
    }
    markMapOpened(mapKey)
    refresh()
    // The map's tab is the one linked to its id. A tab that merely shares the
    // name is a different board and is left alone.
    const existing = state.tabs.find((tab) => tab.mapId === mapKey)
    if (existing) {
      dispatch({ type: 'tab-select', id: existing.id })
      notice(`Switched to "${map.name}"`)
      return
    }
    dispatch({ type: 'tab-add', game: loaded.game, title: map.name, mapId: mapKey })
    notice(loadedNotice(`Loaded "${map.name}"`, loaded.game.board))
  }
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Saved maps</h2>
        </div>
      </div>
      {listed.warning && <p className="notice warning">{listed.warning}</p>}
      <div className="library-list-head">
        <span>{listed.maps.length} {listed.maps.length === 1 ? 'map' : 'maps'}</span>
        {/* MenuSelect rather than a native select: iOS zooms the page when a
            form control under 16px takes focus, which forced the sort control
            to a size out of scale with the rest of the panel. */}
        <span className="map-sort">
          <span>Sort</span>
          <MenuSelect
            ariaLabel="Sort saved maps"
            value={sortKey}
            options={SORT_OPTIONS}
            onSelect={setSortKey}
          >
            <strong>{SORT_MENU_LABEL[sortKey]}</strong>
          </MenuSelect>
        </span>
      </div>
      <div
        ref={scrollerRef}
        className={`saved-maps ${fades.top ? 'fade-top' : ''} ${fades.bottom ? 'fade-bottom' : ''}`}
        onScroll={syncFades}
      >
        {listed.maps.length === 0 && (
          <p className="empty-state">No saved maps yet. Boards save themselves as you edit them.</p>
        )}
        {sortedMaps.map((map, index) => {
          const stamp = sortKey === 'name' ? map.modifiedAt : map[sortKey]
          const metaLabel = sortKey === 'name' ? SORT_LABEL.modifiedAt : SORT_LABEL[sortKey]
          // Only the map shown in the active tab is "open" — the focused board
          // is the one map on screen at any moment. Matched by link, so a blank
          // board that happens to share a name never claims to be this map.
          const isOpen = map.id !== null && map.id === mapId
          // Legacy data can hold duplicate names, so an entry with no id keys
          // off its position rather than a name that may collide.
          return (
            <div key={map.id ?? `unaddressable:${index}`} className={`saved-map ${map.valid ? '' : 'invalid'} ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="saved-map-open"
                disabled={!map.valid}
                title={map.valid ? `Open "${map.name}"` : 'This map is corrupt and cannot be opened'}
                onClick={() => openMap(map)}
              >
                <span className="saved-map-name">{map.name || <em>empty name</em>}</span>
                <span className="saved-map-meta">
                  {!map.valid
                    ? 'corrupt'
                    : isOpen
                      ? 'open'
                      : typeof stamp === 'number'
                        ? `${metaLabel} ${relativeTime(stamp)}`
                        : ''}
                </span>
              </button>
              <button
                type="button"
                className="saved-map-delete"
                aria-label={`Delete ${map.name}`}
                // Only an entry with no name at all is beyond addressing; one
                // that merely lacks an id gets stamped on demand.
                disabled={map.synthetic === true}
                title={map.synthetic === true
                  ? 'This map entry is malformed and cannot be deleted'
                  : `Delete "${map.name}"`}
                onClick={() => {
                  const mapKey = addressable(map)
                  if (mapKey === null) return
                  const result = deleteMap(mapKey)
                  notice(result.ok ? `Deleted "${map.name}"` : result.error)
                  refresh()
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
