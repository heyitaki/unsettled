import { useState } from 'react'
import {
  parseBoardImageWithNames,
  type ParseIssue,
  type RgbaImage,
} from '../parser'
import { listMaps } from '../persistence/localStorage'
import { fileTitle, firstFreeName } from './boardFiles'
import { useStore } from './store'

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

// Screenshot import lives in a modal launched from the Library. On a clean
// parse it closes itself; when the parse raises issues it stays open so they
// can be reviewed and clicked to highlight the offending element on the board.
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [busy, setBusy] = useState(false)
  const notice = (message: string) => dispatch({ type: 'notice', message })
  return (
    <div className="popover-backdrop" onClick={onClose}>
      <div
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Import screenshot"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Import screenshot</h3>
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
                    // Disambiguate the title against open tabs and saved maps so a
                    // repeat import never spawns a second tab with an identical
                    // title — duplicate titles desync the title-as-link to maps.
                    const reserved = new Set([
                      ...state.tabs.map((tab) => tab.title),
                      ...listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name),
                    ])
                    const importTitle = firstFreeName(fileTitle(file.name), reserved)
                    dispatch({ type: 'tab-add', board: result.board, title: importTitle })
                    notice(`Imported ${file.name}`)
                    setIssues(result.issues)
                    if (result.issues.length === 0) onClose()
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
          <strong>{busy ? 'Analyzing board…' : 'Drop screenshot here'}</strong>
          <span>PNG from Settled app, or click to choose</span>
        </label>
        {issues.length > 0 && (
          <div className="issue-list">
            {issues.map((issue, index) => (
              <button
                type="button"
                key={`${issue.stage}:${issue.ref ?? index}`}
                className={issue.severity}
                onClick={() => dispatch({
                  type: 'highlight',
                  marks: issue.ref ? [{ ref: issue.ref }] : null,
                })}
              >
                <span>{issue.stage}</span>
                {issue.message}
              </button>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
