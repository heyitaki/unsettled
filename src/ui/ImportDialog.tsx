import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  parseScreenshot,
  type ParseIssue,
  type RgbaImage,
} from '../parser'
import { listMaps } from '../persistence/localStorage'
import { type Game, mergeScreenshot, type ScreenshotRead } from '../model/game'
import { firstFreeName } from '../model/names'
import { gameSignature } from '../model/serialization'
import { fileTitle, type HeldBoard, mapGame, matchingBoard } from './boardFiles'
import { PhotoGlyph } from './glyphs'
import { useStore } from './store'
import { useLibrary } from './useLibrary'
import { useCoarsePointer } from './useMediaQuery'
import { ModalDialog } from './ModalDialog'

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

/** A parse of a board the app already holds, waiting on the user's answer. */
interface Match {
  fileName: string
  game: Game
  issues: ParseIssue[]
  read: ScreenshotRead
  held: HeldBoard
}

// Screenshot import lives in a modal. On a clean parse it closes itself; when
// the parse raises issues it stays open so they can be reviewed and clicked to
// highlight the offending element on the board. A parse of a board the app
// already holds (same layout, tiles, number tokens and ports) first asks
// whether to update that one or import a separate board. `onImported` runs
// once a parse has landed, as a new tab or an update, before either close.
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const { state, dispatch } = useStore()
  const [issues, setIssues] = useState<ParseIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [match, setMatch] = useState<Match | null>(null)
  const { openMap } = useLibrary()
  const coarse = useCoarsePointer()
  const notice = (message: string) => dispatch({ type: 'notice', message })
  // What every import ends with, a new board or an update.
  const landed = (message: string, parseIssues: ParseIssue[]) => {
    onImported?.()
    notice(message)
    setMatch(null)
    setIssues(parseIssues)
    if (parseIssues.length === 0) onClose()
  }
  const importNew = ({ fileName, game, issues: parseIssues }: Pick<Match, 'fileName' | 'game' | 'issues'>) => {
    // Disambiguate the title against open tabs and saved maps so a
    // repeat import never spawns a second tab with the same label.
    const reserved = new Set([
      ...state.tabs.map((tab) => tab.title),
      ...listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name),
    ])
    dispatch({ type: 'tab-add', game, title: firstFreeName(fileTitle(fileName), reserved) })
    landed(`Imported ${fileName}`, parseIssues)
  }
  const heldName = (held: HeldBoard) => ('map' in held ? held.map.name : held.tab.title)
  const update = ({ fileName, game, issues: parseIssues, read, held }: Match) => {
    // Looked up now, not when the question went up: another window can have
    // edited the board since, and the merge must start from what the tab holds.
    const saved = 'map' in held
      ? mapGame(held.map.id, state.tabs)
      : state.tabs.find((tab) => tab.id === held.tab.id)?.game ?? null
    if (saved === null) return
    // A map is rendered in its tab before the commit: the autosave takes the
    // first game it sees in a tab as already saved, so a map opened and updated
    // in one render would never be written back. A refusal is already toasted,
    // and the question stays up for the other answer.
    if ('tab' in held) dispatch({ type: 'tab-select', id: held.tab.id })
    else if (!flushSync(() => openMap(held.map))) return
    // One commit on the board's own tab, so the update is a single undo step
    // and the autosave writes it into that board's library entry.
    const merged = mergeScreenshot(saved, game, read)
    if (gameSignature(merged) !== gameSignature(saved)) dispatch({ type: 'commit-game', game: merged })
    landed(`Updated "${heldName(held)}" from ${fileName}`, parseIssues)
  }
  // An issue mark outlives the dialog otherwise, and the analysis panel reads a
  // highlight it does not own as a pinned selection: hover previews would stay
  // dead for the rest of the session.
  const marked = useRef(false)
  useEffect(() => () => {
    if (marked.current) dispatch({ type: 'highlight', marks: null })
  }, [dispatch])
  return (
    <ModalDialog title="Import screenshot" className="import-dialog" onClose={onClose}>
      <h3>Import screenshot</h3>
      {match !== null ? (
        <p>You already have this board as "{heldName(match.held)}". Update it from this screenshot, or import it as a new board?</p>
      ) : (
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
              // The last import's toast would otherwise sit beside this one's question.
              dispatch({ type: 'notice', message: null })
              try {
                const image = await decodeImage(file)
                const result = parseScreenshot(image)
                if (result.ok) {
                  const held = matchingBoard(result.game.board, state.tabs)
                  const parsed = { fileName: file.name, game: result.game, issues: result.issues }
                  if (held === null) importNew(parsed)
                  else setMatch({ ...parsed, read: result.read, held })
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
      )}
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
        {match !== null ? (
          <>
            <button type="button" onClick={() => importNew(match)}>Import as new</button>
            <button type="button" className="primary" autoFocus onClick={() => update(match)}>Update</button>
          </>
        ) : <button type="button" onClick={onClose}>Done</button>}
      </div>
    </ModalDialog>
  )
}

/**
 * The hero button that opens the dialog: first in the desktop's Board tools and
 * on the phone's Maps screen. `onNavigate` runs when the dialog closes after a
 * parse has landed, however it closed, and never after a plain dismissal.
 */
export function ImportButton({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const imported = useRef(false)
  return (
    <>
      <button
        type="button"
        className="hero-import"
        onClick={() => {
          imported.current = false
          setOpen(true)
        }}
      >
        <PhotoGlyph />
        Import screenshot
      </button>
      {open && (
        <ImportDialog
          onImported={() => { imported.current = true }}
          onClose={() => {
            setOpen(false)
            if (imported.current) onNavigate?.()
          }}
        />
      )}
    </>
  )
}
