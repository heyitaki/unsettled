import { useEffect, useRef, useState } from 'react'
import {
  parseScreenshot,
  type ParseIssue,
  type RgbaImage,
} from '../parser'
import { listMaps } from '../persistence/localStorage'
import { newId } from '../model/ids'
import { fileTitle, firstFreeName } from './boardFiles'
import { useStore } from './store'
import { useCoarsePointer } from './useMediaQuery'
import { useDialogFocus } from './useDialogFocus'
import { importNames } from './importNames'

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
// `onImported` runs once a parse has become a tab, before either close.
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const dialogRef = useDialogFocus(onClose)
  const { state, dispatch } = useStore()
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [busy, setBusy] = useState(false)
  const coarse = useCoarsePointer()
  const notice = (message: string) => dispatch({ type: 'notice', message })
  // An issue mark outlives the dialog otherwise, and the analysis panel reads a
  // highlight it does not own as a pinned selection: hover previews would stay
  // dead for the rest of the session.
  const marked = useRef(false)
  useEffect(() => () => {
    if (marked.current) dispatch({ type: 'highlight', marks: null })
  }, [dispatch])
  return (
    <div className="popover-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
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
              const input = event.currentTarget
              const file = input.files?.[0]
              if (!file) return
              setBusy(true)
              setIssues([])
              try {
                const image = await decodeImage(file)
                const result = parseScreenshot(image)
                if (result.ok) {
                  // Disambiguate the title against open tabs and saved maps so a
                  // repeat import never spawns a second tab with the same label.
                  const reserved = new Set([
                    ...state.tabs.map((tab) => tab.title),
                    ...listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name),
                  ])
                  const importTitle = firstFreeName(fileTitle(file.name), reserved)
                  const id = newId()
                  dispatch({ type: 'tab-add', id, game: result.game, title: importTitle })
                  onImported?.()
                  notice(`Imported ${file.name}`)
                  setIssues(result.issues)
                  if (result.issues.length === 0) onClose()
                  void importNames(id, image, result, dispatch)
                } else notice(`Screenshot import failed: ${result.error}`)
              } catch (error) {
                notice(`Screenshot import failed: ${error instanceof Error ? error.message : 'unknown error'}`)
              } finally {
                setBusy(false)
                input.value = ''
              }
            }}
          />
          <strong>{busy ? 'Analyzing board…' : coarse ? 'Tap to choose a screenshot' : 'Drop screenshot here'}</strong>
          <span>{coarse ? 'From your photo library, or a PNG file' : 'PNG from Settled app, or click to choose'}</span>
        </label>
        {issues.length > 0 && (
          <div className="issue-list">
            {issues.map((issue, index) => (
              <button
                type="button"
                key={`${issue.stage}:${issue.ref ?? index}`}
                className={issue.severity}
                onClick={() => {
                  marked.current = Boolean(issue.ref)
                  dispatch({ type: 'highlight', marks: issue.ref ? [{ ref: issue.ref }] : null })
                }}
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
