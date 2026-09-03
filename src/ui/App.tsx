import { useMemo } from 'react'
import { analyzeBoardCached } from '../engine/analyze'
import { AnalysisPanel } from './AnalysisPanel'
import { BoardCanvas } from './BoardCanvas'
import { Brand } from './Brand'
import { GlobalNotice } from './GlobalNotice'
import { MapsPanel } from './MapsPanel'
import { PhoneShell } from './phone/PhoneShell'
import { PlayerPanel } from './PlayerPanel'
import { restingMarks } from './restMarks'
import { activeTab, StoreProvider, useStore } from './store'
import { ToolPalette } from './ToolPalette'
import { usePhone } from './useMediaQuery'
import './editor.css'

function Workspace() {
  const { state } = useStore()
  // What the board wears while nothing is selected (spec D4), the same ranked
  // picks the phone rests on.
  const { board } = activeTab(state).game
  const restMarks = useMemo(() => restingMarks(board, analyzeBoardCached(board)), [board])
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
      </header>
      <GlobalNotice />
      <main className="workspace">
        <aside className="left-rail">
          <MapsPanel />
          <ToolPalette />
        </aside>
        <div className="center-column">
          <BoardCanvas restMarks={restMarks} />
        </div>
        <aside className="right-rail">
          <PlayerPanel />
          <AnalysisPanel />
        </aside>
      </main>
    </div>
  )
}

// Two React trees over one store (spec B8): a phone-width viewport gets the
// shell built for it, everything wider keeps the workspace with its rails.
function Shell() {
  return usePhone() ? <PhoneShell /> : <Workspace />
}

export function App() {
  return <StoreProvider><Shell /></StoreProvider>
}
