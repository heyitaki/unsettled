import { useRef, useState } from 'react'
import { setLayout, validateBoard } from '../model/board'
import { parseBoard, serializeBoard } from '../model/serialization'
import type { LayoutId } from '../model/types'
import {
  deleteMap,
  listMaps,
  loadMap,
  saveMap,
} from '../persistence/localStorage'
import { useStore } from './store'

function downloadBoard(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || 'board'}.catan.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function loadedNotice(action: string, board: Parameters<typeof validateBoard>[0]): string {
  const warnings = validateBoard(board).filter((issue) => issue.severity === 'warning')
  if (warnings.length === 0) return action
  const messages = [...new Set(warnings.map((warning) => warning.message))]
  return `${action} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${messages.join('; ')}`
}

export function MapsPanel() {
  const { state, dispatch } = useStore()
  const [name, setName] = useState('My board')
  const [revision, setRevision] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)
  const listed = listMaps()
  const refresh = () => setRevision((value) => value + 1)
  void revision
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const chooseLayout = (layout: LayoutId) => {
    if (layout === state.board.layout) return
    if (!window.confirm('Changing layout clears board placements but keeps your players. Continue?')) return
    dispatch({ type: 'commit', board: setLayout(state.board, layout) })
  }
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Maps</h2>
        </div>
        <div className="layout-toggle">
          <label><input type="radio" checked={state.board.layout === 'standard4'} onChange={() => chooseLayout('standard4')} /> 4P</label>
          <label><input type="radio" checked={state.board.layout === 'extension6'} onChange={() => chooseLayout('extension6')} /> 5–6P</label>
        </div>
      </div>
      <div className="map-save-row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Map name" />
        <button
          type="button"
          className="primary"
          onClick={() => {
            let result = saveMap(name, state.board, false)
            if (!result.ok && result.error.includes('already exists') && window.confirm('Overwrite the existing map?')) {
              result = saveMap(name, state.board, true)
            }
            notice(result.ok ? `Saved “${name}”` : result.error)
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
                dispatch({ type: 'replace', board: loaded.board })
                setName(map.name)
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
        <button type="button" onClick={() => downloadBoard(name, serializeBoard(state.board))}>Export JSON</button>
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
              dispatch({ type: 'replace', board: parsed.board })
              notice(loadedNotice(`Imported ${file.name}`, parsed.board))
            } else notice(`Import failed: ${parsed.errors.join('; ')}`)
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
