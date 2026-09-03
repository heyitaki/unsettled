import { useEffect, useMemo, useState } from 'react'
import { analyzeBoardCached } from '../engine/analyze'
import { AnalysisPanel } from './AnalysisPanel'
import { BoardCanvas } from './BoardCanvas'
import { GlobalNotice } from './GlobalNotice'
import { MapsPanel } from './MapsPanel'
import { MobileNav } from './MobileNav'
import { PANES, type PaneId } from './mobilePanes'
import { PhoneShell } from './phone/PhoneShell'
import { PlayerPanel } from './PlayerPanel'
import { restingMarks } from './restMarks'
import { activeTab, StoreProvider, useStore } from './store'
import { ToolPalette } from './ToolPalette'
import { usePortraitPhone } from './useMediaQuery'
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
  const { state } = useStore()
  // Chosen once per page load, so the tagline rotates between visits.
  const [subtitle] = useState(pickSubtitle)
  const [pane, setPane] = useState<PaneId>(PANES[0].id)
  // What the board wears while nothing is selected (spec D4), the same ranked
  // picks the phone rests on.
  const { board } = activeTab(state).game
  const restMarks = useMemo(() => restingMarks(board, analyzeBoardCached(board)), [board])
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
      <GlobalNotice />
      <main className="workspace">
        <aside className="left-rail">
          <div className="mobile-pane" id="pane-library" data-pane={PANES[3].id}>
            <MapsPanel />
          </div>
          <div className="mobile-pane" id="pane-board" data-pane={PANES[0].id}>
            <ToolPalette />
          </div>
        </aside>
        <div className="center-column">
          <BoardCanvas restMarks={restMarks} />
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
    </div>
  )
}

// Two React trees over one store (spec B8): a portrait phone gets the shell
// built for it, everything else keeps the workspace with its rails and panes.
function Shell() {
  return usePortraitPhone() ? <PhoneShell /> : <Workspace />
}

export function App() {
  return <StoreProvider><Shell /></StoreProvider>
}
