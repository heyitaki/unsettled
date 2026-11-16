import { activePlayerId } from '../model/turn'
import { Ledger } from './Ledger'
import { activeTab, useStore } from './store'

/** The Best moves Ledger card. Under the Finish import card it has no History toggle and no tie lines: the card asks the holders. */
export function LedgerPanel({ className, importing = false }: { className: string; importing?: boolean }) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  return (
    <section className={`${className} best-moves-panel ledger-panel`}>
      <Ledger game={tab.game} activeId={activePlayerId(tab.game)} previous={tab.past.at(-1)}
        commit={(game) => dispatch({ type: 'commit-game', game, correction: true })} onUndo={() => dispatch({ type: 'undo' })}
        historyOpen={state.historyOpen} viewedTurn={state.viewedTurn} ties={!importing}
        onToggleHistory={importing ? undefined : () => dispatch({ type: 'history', open: !state.historyOpen })} />
    </section>
  )
}
