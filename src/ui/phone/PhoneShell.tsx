import { useEffect, useState } from 'react'
import { AnalysisPanel } from '../AnalysisPanel'
import { useBoardActions } from '../boardActions'
import { BoardCanvas } from '../BoardCanvas'
import { GlobalNotice } from '../GlobalNotice'
import type { HeaderPanel } from '../HeaderControls'
import { activeTab, useStore } from '../store'
import { MapsScreen } from './MapsScreen'
import { BoardTools } from '../BoardTools'
import { useBuildMode } from '../useBuildMode'
import { PhoneHeader } from './PhoneHeader'
import { PlayersScreen } from './PlayersScreen'

/** How long a closing overlay stays mounted for its slide out; matches the CSS animation. */
const OVERLAY_EXIT_MS = 280

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The phone tree (spec B8): one sticky header over one document that
 * the window scrolls. Maps and Players are full-screen overlays over it; build
 * mode swaps the block under the board for the tools, holding the game it
 * entered on so Cancel has something to restore (B1).
 */
export function PhoneShell() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const actions = useBoardActions(tab, dispatch)
  const { building, enter, done, cancel, toggle, restMarks } = useBuildMode()
  const [overlay, setOverlay] = useState<HeaderPanel | null>(null)
  // An overlay leaves the way it came: it stays mounted, sliding out, until the
  // timer unmounts it. Opening another during that ride cancels the exit.
  const [closing, setClosing] = useState(false)
  const openOverlay = (next: HeaderPanel) => {
    setClosing(false)
    setOverlay(next)
  }
  const closeOverlay = () => {
    if (reducedMotion()) setOverlay(null)
    else setClosing(true)
  }
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => {
      setOverlay(null)
      setClosing(false)
    }, OVERLAY_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [closing])
  return (
    <div className="phone-shell" data-overlay={overlay ?? undefined} data-closing={closing || undefined}>
      <PhoneHeader building={building} onToggleMode={toggle} onOpen={openOverlay} />
      <main className="phone-page">
        <BoardCanvas restMarks={restMarks} />
        {building ? <BoardTools className="phone-block phone-block-flush phone-build" actions={actions} onDone={done} onCancel={cancel} /> : <AnalysisPanel className="phone-block phone-analysis" onBuild={enter} />}
      </main>
      {overlay === 'maps' && <MapsScreen onClose={closeOverlay} />}
      {overlay === 'players' && <PlayersScreen onClose={closeOverlay} />}
      {actions.confirm}
      <GlobalNotice />
    </div>
  )
}
