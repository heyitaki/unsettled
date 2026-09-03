import { useEffect, useMemo, useState } from 'react'
import { analyzeBoardCached } from '../../engine/analyze'
import { AnalysisPanel } from '../AnalysisPanel'
import { BoardCanvas } from '../BoardCanvas'
import { DraftRibbon } from '../DraftRibbon'
import { GlobalNotice } from '../GlobalNotice'
import { restingMarks } from '../restMarks'
import { activeTab, useStore } from '../store'
import { buildSessionEnded, cancelTarget, openBuildSession, type BuildSession } from './buildMode'
import { MapsScreen } from './MapsScreen'
import { PhoneBuild } from './PhoneBuild'
import { PhoneHeader } from './PhoneHeader'
import { PlayersScreen } from './PlayersScreen'

export type PhoneOverlay = 'maps' | 'players'

/** How long a closing overlay stays mounted for its slide out; matches the CSS animation. */
const OVERLAY_EXIT_MS = 280

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The portrait-phone tree (spec B8): one sticky header over one document that
 * the window scrolls. Maps and Players are full-screen overlays over it; build
 * mode swaps the block under the board for the tools, holding the game it
 * entered on so Cancel has something to restore (B1).
 */
export function PhoneShell() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const [session, setSession] = useState<BuildSession | null>(null)
  const [overlay, setOverlay] = useState<PhoneOverlay | null>(null)
  // An overlay leaves the way it came: it stays mounted, sliding out, until the
  // timer unmounts it. Opening another during that ride cancels the exit.
  const [closing, setClosing] = useState(false)
  const openOverlay = (next: PhoneOverlay) => {
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
  const building = session !== null && !buildSessionEnded(session, tab)
  // What the board shows while nothing is selected (spec S5); bare in build
  // mode, where the analysis block is not on the page.
  const { board } = tab.game
  const restMarks = useMemo(
    () => building ? null : restingMarks(board, analyzeBoardCached(board)),
    [board, building],
  )
  // The store boots with the desktop's default tile tool. Here the pencil is the
  // only way into editing, so a board tap in analyze mode must not paint.
  useEffect(() => {
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }, [dispatch])
  // The board under the tools was replaced (tab switch, import, layout change):
  // that exit is a Done, so the session is dropped without a restore.
  useEffect(() => {
    if (session === null || building) return
    setSession(null)
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }, [session, building, dispatch])
  const enter = () => setSession(openBuildSession(tab))
  const done = () => {
    setSession(null)
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }
  const cancel = () => {
    const game = session && cancelTarget(session, tab)
    if (game) dispatch({ type: 'commit-game', game })
    done()
  }
  return (
    <div className="phone-shell" data-overlay={overlay ?? undefined} data-closing={closing || undefined}>
      <PhoneHeader building={building} onToggleMode={building ? done : enter} onOpen={openOverlay} />
      <main className="phone-page">
        <DraftRibbon />
        <BoardCanvas restMarks={restMarks} />
        {building ? <PhoneBuild onDone={done} onCancel={cancel} /> : <AnalysisPanel className="phone-block phone-analysis" onBuild={enter} />}
      </main>
      {overlay === 'maps' && <MapsScreen onClose={closeOverlay} />}
      {overlay === 'players' && <PlayersScreen onClose={closeOverlay} />}
      <GlobalNotice />
    </div>
  )
}
