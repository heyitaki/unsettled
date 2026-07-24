import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createBoard } from '../model/board'
import type { Board } from '../model/types'
import { serializeBoard } from '../model/serialization'
import {
  deleteMap,
  type ListedMap,
  listMaps,
  loadMap,
  markMapOpened,
  saveMap,
} from '../persistence/localStorage'
import { loadedNotice, nextCopyName } from './boardFiles'
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
  const { id, title, board } = activeTab(state)
  const [name, setName] = useState(title)
  // The save name follows the active tab's title (updating when you switch tabs
  // or rename one), but stays editable for one-off save names.
  useEffect(() => { setName(title) }, [id, title])
  const [revision, setRevision] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  // Capture the board + tab the save targets when the prompt opens, so a tab
  // switch underneath the dialog can't redirect the save to a different board.
  const [dupPrompt, setDupPrompt] = useState<
    { name: string; copyName: string; board: Board; tabId: string } | null
  >(null)
  const listed = listMaps()
  const sortedMaps = [...listed.maps].sort((left, right) => {
    if (sortKey === 'name') return left.name.localeCompare(right.name)
    const leftTimestamp = typeof left[sortKey] === 'number' ? left[sortKey] : -Infinity
    const rightTimestamp = typeof right[sortKey] === 'number' ? right[sortKey] : -Infinity
    if (leftTimestamp === rightTimestamp) return 0
    return rightTimestamp > leftTimestamp ? 1 : -1
  })
  const refresh = () => setRevision((value) => value + 1)
  void revision
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
  const performSave = (saveName: string, overwrite: boolean, target: Board, targetTabId: string) => {
    const result = saveMap(saveName, target, overwrite)
    if (!result.ok) {
      notice(result.error)
      refresh()
      return
    }
    // Link the saved tab to its map by name (title-as-link).
    dispatch({ type: 'tab-rename', id: targetTabId, title: saveName })
    notice(`Saved "${saveName}"`)
    refresh()
  }
  const submitSave = () => {
    // saveMap allows whitespace-only names but the reducer rejects a blank
    // tab-rename, which would leave the tab unlinked — reject here.
    if (name.trim().length === 0) {
      notice('Map name cannot be empty')
      return
    }
    // Block only when the user typed a name that belongs to a *different* open
    // board. Saving the active tab under its own title must always go through —
    // a stray duplicate tab sharing the title shouldn't stop a legitimate save.
    if (name !== title && state.tabs.some((tab) => tab.id !== id && tab.title === name)) {
      notice(`A board named "${name}" is already open`)
      return
    }
    // Only real stored names collide with saveMap; synthetic placeholders for
    // malformed entries are not addressable, so exclude them.
    const taken = new Set(listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name))
    if (taken.has(name)) {
      // A copy must dodge both saved maps and open tab titles so it never
      // shadows another tab's link.
      const reserved = new Set([...taken, ...state.tabs.map((tab) => tab.title)])
      setDupPrompt({ name, copyName: nextCopyName(name, reserved), board, tabId: id })
    } else performSave(name, false, board, id)
  }
  const openMap = (map: ListedMap) => {
    const loaded = loadMap(map.name)
    if (!loaded.ok) {
      notice(loaded.errors.join(', '))
      return
    }
    markMapOpened(map.name)
    refresh()
    const existing = state.tabs.find((tab) => tab.title === map.name)
    if (!existing) {
      dispatch({ type: 'tab-add', board: loaded.board, title: map.name })
      notice(loadedNotice(`Loaded "${map.name}"`, loaded.board))
      return
    }
    dispatch({ type: 'tab-select', id: existing.id })
    // A tab that only shares the map's name but holds a pristine board (e.g. a
    // regenerated "Board 1") is an empty shadow: load the saved board into it
    // instead of focusing a blank one. A tab with real (edited) content is the
    // map's live tab — just focus it.
    const existingSig = serializeBoard(existing.board)
    if (
      existingSig !== serializeBoard(loaded.board) &&
      existingSig === serializeBoard(createBoard(existing.board.layout))
    ) {
      dispatch({ type: 'replace', board: loaded.board })
      notice(loadedNotice(`Loaded "${map.name}"`, loaded.board))
    } else notice(`Switched to "${map.name}"`)
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
        {sortedMaps.map((map) => {
          const stamp = sortKey === 'name' ? map.modifiedAt : map[sortKey]
          const metaLabel = sortKey === 'name' ? SORT_LABEL.modifiedAt : SORT_LABEL[sortKey]
          // Only the map shown in the active tab is "open" — the focused board
          // is the one map on screen at any moment.
          const isOpen = map.name === title
          return (
            <div key={map.name} className={`saved-map ${map.valid ? '' : 'invalid'} ${isOpen ? 'open' : ''}`}>
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
                title={`Delete "${map.name}"`}
                onClick={() => {
                  const result = deleteMap(map.name)
                  notice(result.ok ? `Deleted “${map.name}”` : result.error)
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
                performSave(dupPrompt.name, true, dupPrompt.board, dupPrompt.tabId)
                setDupPrompt(null)
              },
            },
            {
              label: 'Save as copy',
              onClick: () => {
                performSave(dupPrompt.copyName, false, dupPrompt.board, dupPrompt.tabId)
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
