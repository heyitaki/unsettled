import { useState } from 'react'
import { AnalysisPanel } from '../AnalysisPanel'
import { BoardCanvas } from '../BoardCanvas'
import { GlobalNotice } from '../GlobalNotice'
import { PhoneHeader } from './PhoneHeader'

export type PhoneMode = 'analyze' | 'build'
export type PhoneOverlay = 'maps' | 'players'

/**
 * The portrait-phone tree (spec B8): one fixed header over one document that
 * the window scrolls. Maps and Players are full-screen overlays over it; build
 * mode swaps the block under the board. Both are state here and grow their
 * screens in later tasks.
 */
export function PhoneShell() {
  const [mode, setMode] = useState<PhoneMode>('analyze')
  const [overlay, setOverlay] = useState<PhoneOverlay | null>(null)
  return (
    <div className="phone-shell" data-overlay={overlay ?? undefined}>
      <PhoneHeader
        mode={mode}
        onToggleMode={() => setMode((current) => (current === 'build' ? 'analyze' : 'build'))}
        onOpen={setOverlay}
      />
      <main className="phone-page">
        <BoardCanvas />
        <AnalysisPanel />
      </main>
      <GlobalNotice />
    </div>
  )
}
