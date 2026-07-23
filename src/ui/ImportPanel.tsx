import { useState } from 'react'
import {
  parseBoardImageWithNames,
  type ParseIssue,
  type RgbaImage,
} from '../parser'
import { createBrowserTextReader } from '../parser/textReader'
import { useStore } from './store'

function fileTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || name
}

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
  const { dispatch } = useStore()
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <section className="panel import-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Screenshot reader</span>
          <h2>Import a board</h2>
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
                  dispatch({ type: 'notice', message: `Imported ${file.name}` })
                  setIssues(result.issues)
                } else dispatch({ type: 'notice', message: `Screenshot import failed: ${result.error}` })
              } finally {
                await reader.terminate?.()
              }
            } catch (error) {
              dispatch({
                type: 'notice',
                message: `Screenshot import failed: ${error instanceof Error ? error.message : 'unknown error'}`,
              })
            } finally {
              setBusy(false)
              event.target.value = ''
            }
          }}
        />
        <strong>{busy ? 'Analyzing board…' : 'Choose a screenshot'}</strong>
        <span>PNG from the friend app, raw or color-managed</span>
      </label>
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
