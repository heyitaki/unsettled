import { useEffect, useRef, useState } from 'react'
import { setLayout, validateBoard } from '../model/board'
import { parseBoard, serializeBoard } from '../model/serialization'
import type { LayoutId } from '../model/types'
import {
  deleteMap,
  listMaps,
  loadMap,
  saveMap,
} from '../persistence/localStorage'
import { activeTab, useStore } from './store'

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
  const importRef = useRef<HTMLInputElement>(null)
  const listed = listMaps()
  const refresh = () => setRevision((value) => value + 1)
  void revision
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const chooseLayout = (layout: LayoutId) => {
    if (layout === board.layout) return
    if (!window.confirm('Changing layout clears board placements but keeps your players. Continue?')) return
    dispatch({ type: 'commit', board: setLayout(board, layout) })
  }
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Maps</h2>
        </div>
        <div className="layout-toggle">
          <label><input type="radio" checked={board.layout === 'standard4'} onChange={() => chooseLayout('standard4')} /> 4P</label>
          <label><input type="radio" checked={board.layout === 'extension6'} onChange={() => chooseLayout('extension6')} /> 5–6P</label>
        </div>
      </div>
      <div className="map-save-row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Map name" />
        <button
          type="button"
          className="primary"
          onClick={() => {
            // Only real stored names collide with saveMap; synthetic placeholders
            // for malformed entries are not addressable, so exclude them.
            const taken = new Set(listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name))
            let saveName = name
            let overwrite = false
            if (taken.has(name)) {
              if (window.confirm(`A map named “${name}” already exists. Replace it?`)) {
                overwrite = true
              } else if (window.confirm(`Save a copy as “${nextCopyName(name, taken)}” instead?`)) {
                saveName = nextCopyName(name, taken)
              } else return
            }
            const result = saveMap(saveName, board, overwrite)
            notice(result.ok ? `Saved “${saveName}”` : result.error)
            refresh()
          }}
        >Save</button>
      </div>
      {listed.warning && <p className="notice warning">{listed.warning}</p>}
      <div className="saved-maps">
        {listed.maps.length === 0 && <p className="empty-state">No saved maps yet.</p>}
        {listed.maps.map((map) => (
          <div key={map.name} className="saved-map">
            <span>{map.name || <em>empty name</em>}</span>
            {!map.valid && <small>invalid</small>}
            <button type="button" disabled={!map.valid} onClick={() => {
              const loaded = loadMap(map.name)
              if (loaded.ok) {
                // The new tab becomes active, so the save name syncs to map.name.
                dispatch({ type: 'tab-add', board: loaded.board, title: map.name })
                notice(loadedNotice(`Loaded “${map.name}”`, loaded.board))
              } else notice(loaded.errors.join(', '))
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
              dispatch({ type: 'tab-add', board: parsed.board, title: fileTitle(file.name) })
              notice(loadedNotice(`Imported ${file.name}`, parsed.board))
            } else notice(`Import failed: ${parsed.errors.join('; ')}`)
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
