import { useEffect, useState } from 'react'
import { AnalysisPanel } from './AnalysisPanel'
import { BoardCanvas } from './BoardCanvas'
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
  const selectPane = (nextPane: PaneId) => {
    if (nextPane === pane) window.scrollTo({ top: 0, behavior: 'smooth' })
    else setPane(nextPane)
  }
  return (
    <div className="app-shell" data-pane={pane}>
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
        <div className="center-column">
          <BoardTabs />
          <BoardCanvas />
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
