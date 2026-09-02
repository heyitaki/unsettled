import { useEffect, useState } from 'react'
import { AnalysisPanel } from '../AnalysisPanel'
import { BoardCanvas } from '../BoardCanvas'
import { GlobalNotice } from '../GlobalNotice'
import { activeTab, useStore } from '../store'
import { buildSessionEnded, cancelTarget, openBuildSession, type BuildSession } from './buildMode'
import { MapsScreen } from './MapsScreen'
import { PhoneBuild } from './PhoneBuild'
import { PhoneHeader } from './PhoneHeader'
import { PhoneRibbon } from './PhoneRibbon'

export type PhoneMode = 'analyze' | 'build'
export type PhoneOverlay = 'maps' | 'players'

/**
 * The portrait-phone tree (spec B8): one fixed header over one document that
 * the window scrolls. Maps and Players are full-screen overlays over it; build
 * mode swaps the block under the board for the tools, holding the game it
 * entered on so Cancel has something to restore (B1).
 */
export function PhoneShell() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const [session, setSession] = useState<BuildSession | null>(null)
  const [overlay, setOverlay] = useState<PhoneOverlay | null>(null)
  const building = session !== null && !buildSessionEnded(session, tab)
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
    <div className="phone-shell" data-overlay={overlay ?? undefined}>
      <PhoneHeader
        mode={building ? 'build' : 'analyze'}
        onToggleMode={building ? done : enter}
        onOpen={setOverlay}
      />
      <main className="phone-page">
        <PhoneRibbon />
        <BoardCanvas />
        {building ? <PhoneBuild onDone={done} onCancel={cancel} /> : <AnalysisPanel variant="phone" onBuild={enter} />}
      </main>
      {overlay === 'maps' && <MapsScreen onClose={() => setOverlay(null)} />}
      <GlobalNotice />
    </div>
  )
}
