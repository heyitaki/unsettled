import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '../model/game'
import {
  deleteMap,
  type ListedMap,
  listMaps,
  loadMap,
  markMapOpened,
  migrateMapIds,
  readLibrary,
  saveMap,
} from '../persistence/localStorage'
import { loadedNotice, nextCopyName, savesInPlace } from './boardFiles'
import { ConfirmDialog } from './ConfirmDialog'
import { activeTab, useStore } from './store'

type SortKey = 'name' | 'modifiedAt' | 'createdAt' | 'openedAt'

const SORT_LABEL: Record<Exclude<SortKey, 'name'>, string> = {
  modifiedAt: 'Modified',
  createdAt: 'Created',
  openedAt: 'Opened',
}

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
  const { id, title, game, mapId } = activeTab(state)
  const [name, setName] = useState(title)
  // The save name follows the active tab's title (updating when you switch tabs
  // or rename one), but stays editable for one-off save names.
  useEffect(() => { setName(title) }, [id, title])
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  // Capture the game + tab the save targets when the prompt opens, so a tab
  // switch underneath the dialog can't redirect the save to a different board.
  const [dupPrompt, setDupPrompt] = useState<
    { name: string; copyName: string; game: Game; tabId: string } | null
  >(null)
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
    const stamped = listMaps().maps[map.index]?.id ?? null
    if (stamped === null) notice('This map entry is malformed and cannot be opened or deleted')
    return stamped
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
  const performSave = (saveName: string, overwrite: boolean, target: Game, targetTabId: string) => {
    const result = saveMap(saveName, target, overwrite)
    if (!result.ok) {
      notice(result.error)
      refresh()
      return
    }
    // Attach the saved tab to the map it landed in, by id. Overwriting reuses
    // the existing map's id, so re-saving keeps the same link.
    dispatch({ type: 'tab-link', id: targetTabId, mapId: result.id, title: saveName })
    notice(`Saved "${saveName}"`)
    refresh()
  }
  const submitSave = () => {
    // saveMap allows whitespace-only names, but a blank tab title reads as a
    // broken tab — reject here rather than storing one.
    if (name.trim().length === 0) {
      notice('Map name cannot be empty')
      return
    }
    // Only real stored names collide with saveMap; synthetic placeholders for
    // malformed entries are not addressable, so exclude them.
    const named = listMaps().maps.filter((map) => !map.synthetic)
    // Saving a linked tab back into its own map is the ordinary case, not a
    // collision: overwrite it without asking. The prompt is there to stop a
    // save from clobbering some *other* map that happens to share the name.
    if (savesInPlace(named, name, mapId)) {
      performSave(name, true, game, id)
      return
    }
    const taken = new Set(named.map((map) => map.name))
    if (taken.has(name)) {
      // A copy must dodge both saved maps and open tab titles: names no longer
      // carry identity, but a duplicate title is still confusing to read.
      const reserved = new Set([...taken, ...state.tabs.map((tab) => tab.title)])
      setDupPrompt({ name, copyName: nextCopyName(name, reserved), game, tabId: id })
    } else performSave(name, false, game, id)
  }
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
      <div className="map-save-row">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submitSave() }}
          placeholder="Map name"
          aria-label="Map name"
        />
        <button type="button" className="primary" onClick={submitSave}>Save to library</button>
      </div>
      {listed.warning && <p className="notice warning">{listed.warning}</p>}
      <div className="library-list-head">
        <span>{listed.maps.length} {listed.maps.length === 1 ? 'map' : 'maps'}</span>
        <label className="map-sort">
          <span>Sort</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="modifiedAt">Last modified</option>
            <option value="createdAt">Created</option>
            <option value="openedAt">Last opened</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div
        ref={scrollerRef}
        className={`saved-maps ${fades.top ? 'fade-top' : ''} ${fades.bottom ? 'fade-bottom' : ''}`}
        onScroll={syncFades}
      >
        {listed.maps.length === 0 && (
          <p className="empty-state">No saved maps yet. Name the board above and hit Save.</p>
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
      {dupPrompt && (
        <ConfirmDialog
          title={`A map named "${dupPrompt.name}" already exists`}
          actions={[
            {
              label: 'Replace',
              variant: 'danger',
              onClick: () => {
                performSave(dupPrompt.name, true, dupPrompt.game, dupPrompt.tabId)
                setDupPrompt(null)
              },
            },
            {
              label: 'Save as copy',
              onClick: () => {
                performSave(dupPrompt.copyName, false, dupPrompt.game, dupPrompt.tabId)
                setDupPrompt(null)
              },
            },
            { label: 'Cancel', onClick: () => setDupPrompt(null) },
          ]}
          onCancel={() => setDupPrompt(null)}
        />
      )}
    </section>
  )
}
