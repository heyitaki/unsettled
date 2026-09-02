import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SORT_LABEL, SORT_MENU_LABEL, SORT_OPTIONS, type SortKey, relativeTime, stampFor } from './library'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore } from './store'
import { useLibrary } from './useLibrary'

export function MapsPanel() {
  const { state } = useStore()
  const { mapId } = activeTab(state)
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  const { listed, sortedMaps: sortBy, openMap, deleteSavedMap } = useLibrary()
  const sortedMaps = useMemo(() => sortBy(sortKey), [sortBy, sortKey])
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
          const stamp = stampFor(map, sortKey)
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
                onClick={() => deleteSavedMap(map)}
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
