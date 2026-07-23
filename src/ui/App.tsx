import { useEffect, useState } from 'react'
import { BoardCanvas } from './BoardCanvas'
import { BoardTabs } from './BoardTabs'
import { ImportPanel } from './ImportPanel'
import { MapsPanel } from './MapsPanel'
import { PlayerPanel } from './PlayerPanel'
import { StoreProvider, useStore } from './store'
import { ToolPalette } from './ToolPalette'
import './editor.css'

const SUBTITLES = [
  'Settled board analyzer',
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
  // Notices are transient toasts — auto-dismiss so they don't linger. Keyed on
  // noticeSeq so an identical repeat message still restarts the timer.
  useEffect(() => {
    if (!state.notice) return
    const timeout = window.setTimeout(() => dispatch({ type: 'notice', message: null }), 3500)
    return () => window.clearTimeout(timeout)
  }, [state.notice, state.noticeSeq, dispatch])
  return (
    <div className="app-shell">
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
        <button type="button" className="global-notice" onClick={() => dispatch({ type: 'notice', message: null })}>
          {state.notice}<span>×</span>
        </button>
      )}
      <main className="workspace">
        <aside className="left-rail">
          <ToolPalette />
          <ImportPanel />
        </aside>
        <div className="center-column">
          <BoardTabs />
          <BoardCanvas />
        </div>
        <aside className="right-rail">
          <PlayerPanel />
          <MapsPanel />
        </aside>
      </main>
      <footer>
        <span>Phase 1 · editor + screenshot import</span>
      </footer>
    </div>
  )
}

export function App() {
  return <StoreProvider><Workspace /></StoreProvider>
}
