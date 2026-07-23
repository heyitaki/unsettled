import { BoardCanvas } from './BoardCanvas'
import { ImportPanel } from './ImportPanel'
import { MapsPanel } from './MapsPanel'
import { PlayerPanel } from './PlayerPanel'
import { StoreProvider, useStore } from './store'
import { ToolPalette } from './ToolPalette'
import './editor.css'

function Workspace() {
  const { state, dispatch } = useStore()
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <span className="eyebrow">Starting position lab</span>
          <h1>Unsettled</h1>
        </div>
        <p>Shape the island now. Read the opening later.</p>
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
        <BoardCanvas />
        <aside className="right-rail">
          <PlayerPanel />
          <MapsPanel />
        </aside>
      </main>
      <footer>
        <span>Phase 1 · editor + screenshot import</span>
        <span>All map data stays in this browser.</span>
      </footer>
    </div>
  )
}

export function App() {
  return <StoreProvider><Workspace /></StoreProvider>
}
