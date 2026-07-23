import { useEffect, useRef, useState } from 'react'
import { createBoard, validateBoard } from '../model/board'
import type { Board } from '../model/types'
import { parseBoard, serializeBoard } from '../model/serialization'
import {
  deleteMap,
  listMaps,
  loadMap,
  markMapOpened,
  saveMap,
} from '../persistence/localStorage'
import { ConfirmDialog } from './ConfirmDialog'
import { activeTab, useStore } from './store'

type SortKey = 'name' | 'modifiedAt' | 'createdAt' | 'openedAt'

function downloadBoard(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || 'board'}.catan.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function fileTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || name
}

// First unused "base (n)" name, so a copy never clobbers an existing map.
function nextCopyName(base: string, taken: Set<string>): string {
  let index = 1
  while (taken.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

// `base` if free, else the first unused "base (n)". Keeps new tab titles from
// shadowing another open tab or a saved map (title-as-link stays unambiguous).
function firstFreeName(base: string, taken: Set<string>): string {
  return taken.has(base) ? nextCopyName(base, taken) : base
}

function loadedNotice(action: string, board: Parameters<typeof validateBoard>[0]): string {
  const warnings = validateBoard(board).filter((issue) => issue.severity === 'warning')
  if (warnings.length === 0) return action
  const messages = [...new Set(warnings.map((warning) => warning.message))]
  return `${action} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${messages.join('; ')}`
}

export function MapsPanel() {
  const { state, dispatch } = useStore()
  const { id, title, board } = activeTab(state)
  const [name, setName] = useState(title)
  // The save name follows the active tab's title (updating when you switch tabs
  // or rename one), but stays editable for one-off save names.
  useEffect(() => { setName(title) }, [id, title])
  const [revision, setRevision] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  // Capture the board + tab the save targets when the prompt opens, so a tab
  // switch underneath the dialog can't redirect the save to a different board.
  const [dupPrompt, setDupPrompt] = useState<
    { name: string; copyName: string; board: Board; tabId: string } | null
  >(null)
  const importRef = useRef<HTMLInputElement>(null)
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
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Maps</h2>
        </div>
        <label className="map-sort">
          <span>Sort</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="modifiedAt">Last modified</option>
            <option value="createdAt">Created</option>
            <option value="openedAt">Last opened</option>
          </select>
        </label>
      </div>
      <div className="map-save-row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Map name" />
        <button
          type="button"
          className="primary"
          onClick={() => {
            // saveMap allows whitespace-only names but the reducer rejects a
            // blank tab-rename, which would leave the tab unlinked — reject here.
            if (name.trim().length === 0) {
              notice('Map name cannot be empty')
              return
            }
            if (state.tabs.some((tab) => tab.id !== id && tab.title === name)) {
              notice(`A board named "${name}" is already open`)
              return
            }

            // Only real stored names collide with saveMap; synthetic placeholders
            // for malformed entries are not addressable, so exclude them.
            const taken = new Set(listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name))
            if (taken.has(name)) {
              // A copy must dodge both saved maps and open tab titles so it never
              // shadows another tab's link.
              const reserved = new Set([...taken, ...state.tabs.map((tab) => tab.title)])
              setDupPrompt({ name, copyName: nextCopyName(name, reserved), board, tabId: id })
            } else performSave(name, false, board, id)
          }}
        >Save</button>
      </div>
      {listed.warning && <p className="notice warning">{listed.warning}</p>}
      <div className="saved-maps">
        {listed.maps.length === 0 && <p className="empty-state">No saved maps yet.</p>}
        {sortedMaps.map((map) => (
          <div key={map.name} className="saved-map">
            <span>{map.name || <em>empty name</em>}</span>
            {!map.valid && <small>invalid</small>}
            <button type="button" disabled={!map.valid} onClick={() => {
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
              // A tab that only shares the map's name but holds a pristine board
              // (e.g. a regenerated "Board 1") is an empty shadow: load the saved
              // board into it instead of focusing a blank one. A tab with real
              // (edited) content is the map's live tab — just focus it.
              const existingSig = serializeBoard(existing.board)
              if (
                existingSig !== serializeBoard(loaded.board) &&
                existingSig === serializeBoard(createBoard(existing.board.layout))
              ) {
                dispatch({ type: 'replace', board: loaded.board })
                notice(loadedNotice(`Loaded "${map.name}"`, loaded.board))
              } else notice(`Switched to "${map.name}"`)
            }}>Load</button>
            <button type="button" className="icon-danger" onClick={() => {
              const result = deleteMap(map.name)
              notice(result.ok ? `Deleted “${map.name}”` : result.error)
              refresh()
            }}>×</button>
          </div>
        ))}
      </div>
      <div className="file-actions">
        <button type="button" onClick={() => downloadBoard(name, serializeBoard(board))}>Export JSON</button>
        <button type="button" onClick={() => importRef.current?.click()}>Import JSON</button>
        <input
          ref={importRef}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const parsed = parseBoard(await file.text())
            if (parsed.ok) {
              // Disambiguate against open tabs and saved maps so the import
              // never shadows an existing tab's map link.
              const reserved = new Set([
                ...state.tabs.map((tab) => tab.title),
                ...listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name),
              ])
              const importTitle = firstFreeName(fileTitle(file.name), reserved)
              dispatch({ type: 'tab-add', board: parsed.board, title: importTitle })
              notice(loadedNotice(`Imported ${file.name}`, parsed.board))
            } else notice(`Import failed: ${parsed.errors.join('; ')}`)
            event.target.value = ''
          }}
        />
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
