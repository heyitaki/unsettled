import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AnalysisPanel } from './AnalysisPanel'
import { BoardCanvas } from './BoardCanvas'
import { DECK_KEY_STEP, MIN_DECK_BOARD_HEIGHT, clampDeckBoardHeight, deckBoardCeiling } from './boardDeck'
import { BoardTabs } from './BoardTabs'
import { ImportPanel } from './ImportPanel'
import { MapsPanel } from './MapsPanel'
import { MobileNav } from './MobileNav'
import { PANES, type PaneId } from './mobilePanes'
import { PlayerPanel } from './PlayerPanel'
import { StoreProvider, useStore } from './store'
import { ToolPalette } from './ToolPalette'
import './editor.css'

const SUBTITLES = [
  'Catan Map Analyzer',
  'Min-maxing manipulating friends',
  'GC BWR NW Best-in-dungeon',
  'Winner POV',
]
// Every so often the app roasts you instead.
const RARE_SUBTITLE = 'Your face is unsettling'

function pickSubtitle(): string {
  if (Math.random() < 0.1) return RARE_SUBTITLE
  return SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)]
}

function Workspace() {
  const { state, dispatch } = useStore()
  // Chosen once per page load, so the tagline rotates between visits.
  const [subtitle] = useState(pickSubtitle)
  // Pause auto-dismiss while the pointer is over the toast, so it can be read,
  // clicked, and text-selected; the timer restarts fresh once the pointer leaves.
  const [noticeHover, setNoticeHover] = useState(false)
  const [pane, setPane] = useState<PaneId>(PANES[0].id)
  // null means "whatever the board's own aspect ratio wants at this width",
  // which is the default and fills the screen edge to edge in portrait. A drag
  // pins an explicit height instead.
  const [boardHeight, setBoardHeight] = useState<number | null>(null)
  // The viewport the pinned height is measured against. Kept in state so the
  // applied height below re-derives whenever the window changes size.
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  // The board's aspect-ratio height while nothing is pinned, so the separator
  // can announce a real number to assistive tech.
  const [renderedHeight, setRenderedHeight] = useState<number | null>(null)
  // Everything in the viewport that is not the board canvas, measured below.
  // Starts at zero so the first render cannot invent a cap out of a guess; the
  // layout effect replaces it with the real figure before the first paint.
  const [reserved, setReserved] = useState(0)
  const shellRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  // height is null until the pointer actually moves, so a tap on the handle
  // leaves the board unpinned rather than freezing today's aspect-ratio height.
  const grab = useRef<{ pointerId: number; startY: number; startHeight: number; height: number | null } | null>(null)
  // Notices are transient toasts — auto-dismiss so they don't linger. Keyed on
  // noticeSeq so an identical repeat message still restarts the timer.
  useEffect(() => {
    if (!state.notice || noticeHover) return
    const timeout = window.setTimeout(() => dispatch({ type: 'notice', message: null }), 3500)
    return () => window.clearTimeout(timeout)
  }, [state.notice, state.noticeSeq, noticeHover, dispatch])
  useEffect(() => {
    const showNotice = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      dispatch({ type: 'notice', message: event.detail })
    }
    window.addEventListener('unsettled:notice', showNotice)
    return () => window.removeEventListener('unsettled:notice', showNotice)
  }, [dispatch])
  // The mobile shell scrolls the document, so switching panes has to rewind the
  // page rather than a pane-local scroller.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [pane])
  // Tracking the viewport re-derives the applied height below on every resize,
  // so a passive viewport change (rotation, the URL bar sliding in) only clamps
  // the pinned height for as long as it lasts and the requested one comes back
  // when there is room again — the original bug was ratcheting it away. An
  // explicit resize does re-pin against the viewport it happened in: the drag
  // and the arrow keys both store an already-clamped height, deliberately, so
  // the handle has no dead travel above the cap.
  useEffect(() => {
    const track = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', track)
    return () => window.removeEventListener('resize', track)
  }, [])
  const pinned = boardHeight !== null
  // The default height belongs to the board's own aspect ratio, so it has to be
  // measured. Only while unpinned, and never mid-drag: the drag deliberately
  // keeps its height out of state, and answering it here would re-render the
  // whole workspace per frame anyway.
  useLayoutEffect(() => {
    if (pinned) return
    const canvas = deckRef.current?.querySelector('.board-canvas')
    if (!canvas) return
    const record = (height: number) => {
      if (grab.current) return
      // A zero measurement means the canvas is between layouts, not that the
      // board is zero tall. Storing it would beat the ?? floor below, which
      // only rejects null, and hand the next drag an origin of 0.
      if (height > 0) setRenderedHeight(height)
    }
    // Seeded from the live box rather than left to the observer alone, from the
    // layout phase rather than a passive effect: the observer's first delivery
    // lands after this frame's animation callbacks and re-renders on a later
    // task, so the frame that paints first would still announce the floor for a
    // 360px board and hand a pointerdown landing in it an origin of 120, which
    // jumps the board on the first move. A layout-phase setState renders again
    // before paint, so the first frame the user sees already reads true.
    record(canvas.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => record(entry.contentRect.height))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [pinned])
  // The cap the board is held to is the viewport minus the chrome it shares the
  // viewport with, and that chrome is all real DOM: measure it rather than
  // restating its height as a number here and again in the stylesheet.
  const measureReserve = useCallback(() => {
    const canvas = deckRef.current?.querySelector('.board-canvas')
    const grabber = deckRef.current?.querySelector('.pane-grabber')
    if (!canvas || !grabber) return
    const grabberBox = grabber.getBoundingClientRect()
    // No grabber box means no draggable deck — the desktop and landscape arms
    // both hide it, and neither reads the cap. Keeping the last portrait
    // measurement beats replacing it with a meaningless one.
    if (grabberBox.height === 0) return
    const canvasBox = canvas.getBoundingClientRect()
    const nav = shellRef.current?.querySelector('.mobile-nav')
    // Both spans are measured around the canvas rather than from it, so they do
    // not move when it does: a drag cannot feed back into its own limit. Above
    // it sits the shell's top padding and the header; below it, inside the deck,
    // the status line and the grab handle; below that the fixed bottom nav,
    // which overlays the viewport and so has to be cleared as well.
    const above = canvasBox.top + window.scrollY
    const below = grabberBox.bottom - canvasBox.bottom
    const navHeight = nav ? nav.getBoundingClientRect().height : 0
    setReserved(Math.round(above + below + navHeight))
  }, [])
  // viewportHeight re-runs this on every resize and rotation; the observer
  // catches the one row whose height is content-dependent, the status line,
  // which wraps to a second line on a narrow phone.
  useLayoutEffect(() => {
    measureReserve()
    const status = deckRef.current?.querySelector('.board-status')
    if (!status) return
    const observer = new ResizeObserver(measureReserve)
    observer.observe(status)
    return () => observer.disconnect()
  }, [measureReserve, viewportHeight])
  const selectPane = (nextPane: PaneId) => {
    if (nextPane === pane) window.scrollTo({ top: 0, behavior: 'smooth' })
    else setPane(nextPane)
  }
  const appliedHeight = boardHeight === null ? null : clampDeckBoardHeight(boardHeight, viewportHeight, reserved)
  // Clamped against the viewport the drag is happening in, so the handle has no
  // dead travel; the render-time clamp above covers later viewport changes.
  const resizeBoard = (height: number) => setBoardHeight(clampDeckBoardHeight(height, viewportHeight, reserved))
  // One fallback chain for every reader: the pinned height, else what the
  // aspect ratio produced, else the floor.
  const currentHeight = appliedHeight ?? renderedHeight ?? MIN_DECK_BOARD_HEIGHT
  const ceiling = deckBoardCeiling(viewportHeight, reserved)
  // Both properties are written straight to the shell rather than through a
  // style prop, because a drag writes --board-h to the same place and an
  // unrelated re-render must not stomp it.
  // The cap follows the viewport, so a mid-drag resize moves the limit the next
  // pointermove clamps against.
  useLayoutEffect(() => {
    shellRef.current?.style.setProperty('--board-max', `${Math.round(ceiling)}px`)
  }, [ceiling])
  // The height belongs to the drag until endGrab commits it: writing the stored
  // value back mid-gesture would tear the board away from the finger.
  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell || grab.current) return
    if (appliedHeight === null) shell.style.removeProperty('--board-h')
    else shell.style.setProperty('--board-h', `${Math.round(appliedHeight)}px`)
  }, [appliedHeight])
  const onGrabDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // One pointer owns the drag: a second finger landing on the full-width
    // handle would otherwise rewrite the origin and teleport the board.
    if (grab.current) return
    // Only the primary button. A right-click would leave the drag live, because
    // the context menu swallows the pointerup that ends it.
    if (event.button !== 0) return
    grab.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: currentHeight, height: null }
    // Capturing throws if the pointer is already gone (a system gesture taking
    // over between the down and here). Uncaught it would strand grab.current
    // with no capture and no event left to clear it, which deadens the handle
    // and mutes the canvas observer for the rest of the session — so drop the
    // drag instead and let the next pointerdown start a clean one.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      grab.current = null
    }
  }
  // Commits what the drag wrote to the DOM, so the separator's announced value
  // and the next drag's origin agree with what is on screen.
  const endGrab = () => {
    const drag = grab.current
    grab.current = null
    if (drag && drag.height !== null) setBoardHeight(drag.height)
  }
  const onGrabMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = grab.current
    if (drag?.pointerId !== event.pointerId) return
    // A mouse reporting no held button has already finished its drag somewhere
    // we never heard about; plain hover must not resize the board.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      endGrab()
      return
    }
    const height = clampDeckBoardHeight(drag.startHeight + (event.clientY - drag.startY), viewportHeight, reserved)
    drag.height = height
    // Straight to the DOM, no state: none of the four panes is memoised and the
    // hidden ones stay mounted, so a setState per pointermove rebuilds every
    // panel and the whole board SVG between frames. State catches up on release.
    shellRef.current?.style.setProperty('--board-h', `${Math.round(height)}px`)
  }
  // Also the lost-capture fallback: hiding the handle mid-drag (rotating into
  // landscape) delivers neither pointerup nor pointercancel.
  const onGrabEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (grab.current?.pointerId !== event.pointerId) return
    endGrab()
  }
  const onGrabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Home restores the aspect-ratio default, the one height with no wasted gap.
    if (event.key === 'Home') {
      setBoardHeight(null)
      event.preventDefault()
      return
    }
    const step = event.key === 'ArrowUp' ? -DECK_KEY_STEP : event.key === 'ArrowDown' ? DECK_KEY_STEP : 0
    if (step === 0) return
    resizeBoard(currentHeight + step)
    event.preventDefault()
  }
  return (
    <div className="app-shell" data-pane={pane} ref={shellRef}>
      <header className="site-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <span className="eyebrow">{subtitle}</span>
          <h1>Unsettled</h1>
        </div>
      </header>
      {state.notice && (
        <div
          className="global-notice"
          role="status"
          onMouseEnter={() => setNoticeHover(true)}
          onMouseLeave={() => setNoticeHover(false)}
        >
          <span className="global-notice-text">{state.notice}</span>
          <button
            type="button"
            className="global-notice-close"
            aria-label="Dismiss notification"
            // Closing unmounts the toast without firing onMouseLeave, so clear the
            // hover flag here or the next notice would never auto-dismiss.
            onClick={() => {
              setNoticeHover(false)
              dispatch({ type: 'notice', message: null })
            }}
          >
            ×
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className="left-rail">
          <div className="mobile-pane" id="pane-board" data-pane={PANES[0].id}>
            <ToolPalette />
          </div>
          <div className="mobile-pane" id="pane-library" data-pane={PANES[3].id}>
            <ImportPanel />
            <MapsPanel />
          </div>
        </aside>
        {/* The board and its handle are one block so the mobile shell can pin
            them together while the panes scroll underneath. `display: contents`
            keeps the desktop grid seeing the same children it always did. */}
        <div className="board-deck" ref={deckRef}>
          <div className="center-column" id="board-view">
            <BoardTabs />
            <BoardCanvas />
          </div>
          {/* A focusable separator is a splitter widget, so it has to carry the
              value it moves — otherwise an arrow-key resize announces nothing. */}
          <div
            className="pane-grabber"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the board"
            aria-controls="board-view"
            aria-valuenow={Math.round(currentHeight)}
            aria-valuemin={MIN_DECK_BOARD_HEIGHT}
            aria-valuemax={Math.round(ceiling)}
            tabIndex={0}
            onPointerDown={onGrabDown}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
            onLostPointerCapture={onGrabEnd}
            onKeyDown={onGrabKeyDown}
          >
            <span />
          </div>
        </div>
        <aside className="right-rail">
          <div className="mobile-pane" id="pane-players" data-pane={PANES[1].id}>
            <PlayerPanel />
          </div>
          <div className="mobile-pane" id="pane-picks" data-pane={PANES[2].id}>
            <AnalysisPanel />
          </div>
        </aside>
      </main>
      <MobileNav pane={pane} onSelect={selectPane} />
      <footer>
        <span>Phase 2 · draft analysis</span>
      </footer>
    </div>
  )
}

export function App() {
  return <StoreProvider><Workspace /></StoreProvider>
}
