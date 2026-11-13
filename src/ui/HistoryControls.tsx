import { historyPlayer } from '../model/history'
import { ChevronGlyph } from './glyphs'
import { activeTab, useStore } from './store'

export function HistoryControls() {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  if (!state.historyOpen || !game.turn || state.tool.kind !== 'none') return null
  const now = (game.history?.turns.length ?? 0) + 1
  const index = state.viewedTurn ?? now
  const turn = index === now ? game.turn : game.history?.turns[index - 1]
  const player = historyPlayer(game.board, turn?.playerId)
  const select = (index: number) => dispatch({ type: 'view-turn', index: index === now ? null : index })
  return (
    <div className="history-controls" role="toolbar" aria-label="Turn shown">
      <button type="button" className="history-earlier" aria-label="Earlier turn" disabled={index === (game.history ? 0 : now)} onClick={() => select(index - 1)}><ChevronGlyph /></button>
      <span className="history-label">{index === 0 ? 'Game start' : <>
        <span className="swatch" style={{ background: player.color }} />Turn {index}
        <span className="muted">· {player.name}{turn?.rolled != null ? ` rolled ${turn.rolled}` : ''}</span>
      </>}</span>
      <button type="button" className="history-later" aria-label="Later turn" disabled={index === now} onClick={() => select(index + 1)}><ChevronGlyph /></button>
      <span className="history-divider" aria-hidden="true" />
      <button type="button" className="history-now-button" disabled={index === now} onClick={() => select(now)}>Back to now</button>
    </div>
  )
}
