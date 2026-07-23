import { useRef, useState } from 'react'
import { parseBoard, serializeBoard } from '../model/serialization'
import {
  parseBoardImageWithNames,
  type ParseIssue,
  type RgbaImage,
} from '../parser'
import { listMaps } from '../persistence/localStorage'
import { downloadBoard, fileTitle, firstFreeName, loadedNotice } from './boardFiles'
import { activeTab, useStore } from './store'

async function decodeImage(file: File): Promise<RgbaImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas image decoding is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: data.data }
}

export function ImportPanel() {
  const { state, dispatch } = useStore()
  const { title, board } = activeTab(state)
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [busy, setBusy] = useState(false)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const notice = (message: string) => dispatch({ type: 'notice', message })
  return (
    <section className="panel import-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Screenshot reader</span>
          <h2>Import &amp; export</h2>
        </div>
        {busy && <span className="working">Reading…</span>}
      </div>
      <label className="drop-zone">
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setBusy(true)
            setIssues([])
            try {
              const image = await decodeImage(file)
              let reader
              let startupError: unknown
              try {
                // Dynamic import keeps the tesseract.js wrapper out of the
                // initial /unsettled bundle — it loads only on first import.
                const { createBrowserTextReader } = await import('../parser/textReader')
                reader = await createBrowserTextReader()
              } catch (error) {
                startupError = error
                reader = {
                  async read() {
                    throw startupError
                  },
                }
              }
              try {
                const result = await parseBoardImageWithNames(image, reader)
                if (result.ok) {
                  dispatch({ type: 'tab-add', board: result.board, title: fileTitle(file.name) })
                  notice(`Imported ${file.name}`)
                  setIssues(result.issues)
                } else notice(`Screenshot import failed: ${result.error}`)
              } finally {
                await reader.terminate?.()
              }
            } catch (error) {
              notice(`Screenshot import failed: ${error instanceof Error ? error.message : 'unknown error'}`)
            } finally {
              setBusy(false)
              event.target.value = ''
            }
          }}
        />
        <strong>{busy ? 'Analyzing board…' : 'Choose a screenshot'}</strong>
        <span>PNG from Settled app</span>
      </label>
      <div className="file-actions">
        <button type="button" onClick={() => jsonInputRef.current?.click()}>Import JSON</button>
        <button type="button" onClick={() => downloadBoard(title, serializeBoard(board))}>Export JSON</button>
        <input
          ref={jsonInputRef}
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
      {issues.length > 0 && (
        <div className="issue-list">
          {issues.map((issue, index) => (
            <button
              type="button"
              key={`${issue.stage}:${issue.ref ?? index}`}
              className={issue.severity}
              onClick={() => dispatch({ type: 'highlight', ref: issue.ref ?? null })}
            >
              <span>{issue.stage}</span>
              {issue.message}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
