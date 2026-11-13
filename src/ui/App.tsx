import { useEffect, useState } from 'react'
import { AnalysisProvider } from './AnalysisProvider'
import { AdviceProvider } from './AdviceProvider'
import { AnalysisPanel } from './AnalysisPanel'
import { BoardCanvas } from './BoardCanvas'
import { Brand } from './Brand'
import { BoardTools } from './BoardTools'
import { useBoardActions } from './boardActions'
import { HeaderControls, type HeaderPanel } from './HeaderControls'
import { HeaderPopover } from './HeaderPopover'
import { HistoryControls } from './HistoryControls'
import { ImportButton } from './ImportDialog'
import { useBuildMode } from './useBuildMode'
import { GlobalNotice } from './GlobalNotice'
import { MapsPanel } from './MapsPanel'
import { PhoneShell } from './phone/PhoneShell'
import { PlayerPanel } from './PlayerPanel'
import { activeTab, StoreProvider, useStore } from './store'
import { usePhone } from './useMediaQuery'
import './editor.css'

function Workspace() {
  const { state, dispatch } = useStore()
  const actions = useBoardActions(activeTab(state), dispatch)
  const { building, enter, done, cancel, toggle, restMarks } = useBuildMode()
  const [open, setOpen] = useState<{ panel: HeaderPanel; trigger: HTMLButtonElement } | null>(null)
  useEffect(() => setOpen((current) => current?.panel === 'players' ? null : current), [building])
  const togglePanel = (panel: HeaderPanel, trigger: HTMLButtonElement) => {
    setOpen((current) => current?.panel === panel ? null : { panel, trigger })
  }
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <div className="head-controls">
          <HeaderControls building={building} onToggleMode={toggle} onOpen={togglePanel} openPanel={open?.panel ?? null} />
          <ImportButton />
        </div>
        {open && (
          <HeaderPopover key={open.panel} label={open.panel === 'maps' ? 'Maps' : 'Players'} className={open.panel === 'maps' ? 'head-maps' : 'head-players'} trigger={open.trigger} onClose={() => setOpen((current) => current === open ? null : current)}>
            {open.panel === 'maps' ? <MapsPanel /> : <PlayerPanel />}
          </HeaderPopover>
        )}
      </header>
      <GlobalNotice />
      <main className={`workspace${state.historyOpen && !building ? ' history-open' : ''}`}>
        <div className="center-column">
          <BoardCanvas restMarks={restMarks} />
          {!building && <HistoryControls />}
        </div>
        <aside className="right-rail">
          {building ? <BoardTools actions={actions} onDone={done} onCancel={cancel} /> : <AnalysisPanel onBuild={enter} />}
        </aside>
      </main>
      {actions.confirm}
    </div>
  )
}

// Two React trees over one store (spec B8): a phone-width viewport gets the
// shell built for it, everything wider keeps the workspace.
function Shell() {
  const { dispatch } = useStore()
  const phone = usePhone()

  // A tree swap drops its build session and tool together.
  useEffect(() => {
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }, [phone, dispatch])
  return phone ? <PhoneShell /> : <Workspace />
}

export function App() {
  return <StoreProvider><AnalysisProvider><AdviceProvider><Shell /></AdviceProvider></AnalysisProvider></StoreProvider>
}
