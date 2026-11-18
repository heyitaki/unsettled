import { useEffect, useRef, useState } from 'react'
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
import { ImportDialog, SharedImport } from './ImportDialog'
import { useBuildMode } from './useBuildMode'
import { GlobalNotice } from './GlobalNotice'
import { MapsPanel } from './MapsPanel'
import { PhoneShell } from './phone/PhoneShell'
import { PlayerPanel } from './PlayerPanel'
import { activeTab, StoreProvider, useStore } from './store'
import { usePhone, useStacked } from './useMediaQuery'
import { useColumnGlide } from './useColumnGlide'
import './editor.css'

function Workspace() {
  const { state, dispatch } = useStore()
  const actions = useBoardActions(activeTab(state), dispatch)
  const { building, enter, done, cancel, toggle, restMarks } = useBuildMode()
  const [open, setOpen] = useState<{ panel: HeaderPanel; trigger: HTMLButtonElement } | null>(null)
  const [importing, setImporting] = useState(false)
  // Side by side, the controls head the column, which centres on the board and glides as its cards change.
  const stacked = useStacked()
  const rail = useRef<HTMLElement>(null)
  useColumnGlide(rail, !stacked)
  useEffect(() => setOpen((current) => current?.panel === 'players' ? null : current), [building])
  // The open panel lives in the header when stacked and in the column side by side, so a switch closes it.
  useEffect(() => setOpen(null), [stacked])
  const togglePanel = (panel: HeaderPanel, trigger: HTMLButtonElement) => {
    setOpen((current) => current?.panel === panel ? null : { panel, trigger })
  }
  // Focus moves to the title first, so the dialog returns it there: the Import button unmounts with the panel.
  const maps = <MapsPanel onImport={() => { open?.trigger.focus(); setOpen(null); setImporting(true) }} />
  const controls = (
    <div className="head-controls">
      <HeaderControls building={building} onToggleMode={() => { setOpen(null); toggle() }} onOpen={togglePanel} openPanel={open?.panel ?? null} />
    </div>
  )
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        {stacked && controls}
        {open && stacked && (
          <HeaderPopover key={open.panel} label={open.panel === 'maps' ? 'Maps' : 'Players'} className={open.panel === 'maps' ? 'head-maps' : 'head-players'} trigger={open.trigger} onClose={() => setOpen((current) => current === open ? null : current)}>
            {open.panel === 'maps' ? maps : <PlayerPanel />}
          </HeaderPopover>
        )}
      </header>
      <GlobalNotice />
      <main className={`workspace${state.historyOpen && !building ? ' history-open' : ''}`}>
        <div className="center-column">
          <BoardCanvas restMarks={restMarks} />
          {!building && <HistoryControls />}
        </div>
        <aside
          className="right-rail"
          ref={rail}
          // Escape closes a column panel as it closes a popover, unless a field, menu or dialog inside handled it.
          onKeyDown={(event) => {
            if (stacked || !open || event.key !== 'Escape' || event.defaultPrevented) return
            if (event.target instanceof Element && event.target.closest('dialog, [popover]')) return
            open.trigger.focus()
            setOpen(null)
          }}
        >
          {!stacked && controls}
          {/* Side by side, Maps takes the column like Board tools and Players joins it above the other cards. */}
          {!stacked && open?.panel === 'players' && <PlayerPanel />}
          {!stacked && open?.panel === 'maps' ? maps
            : building ? <BoardTools actions={actions} onDone={done} onCancel={cancel} />
            : <AnalysisPanel onBuild={enter} />}
        </aside>
      </main>
      {actions.confirm}
      {/* The dialog outlives the Maps panel that opens it, and restores focus on close. */}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <SharedImport />
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
