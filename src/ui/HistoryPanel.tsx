import { Fragment, type ReactNode } from 'react'
import { pips } from '../model/board'
import { currentTurnNumber, historyPlayer, turnSummary } from '../model/history'
import { PLAYER_PALETTE } from '../model/types'
import { ProductionPlayer } from './BestMovesTrays'
import { readableInk } from './colors'
import { ArrowLeftGlyph, ArrowRightGlyph, BoardHexGlyph, CloseGlyph, RobberGlyph, TickGlyph } from './glyphs'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore } from './store'
import { useRevealRow, useScrollEdges } from './useScrollEdges'

/** A turn or rank number on the player's colour, with an ink ring for white. */
export function PlayerDisc({ color, className = '', children }: { color: string; className?: string; children: ReactNode }) {
  const light = color.toLowerCase() === PLAYER_PALETTE.white
  return <span className={`history-disc${light ? ' light' : ''}${className && ` ${className}`}`} style={{ background: color, color: readableInk(color) }}>{children}</span>
}

export function HistoryPanel({ className = 'panel analysis-panel' }: { className?: string }) {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  const turns = game.history?.turns ?? []
  const now = currentTurnNumber(game)
  // A game saved before history existed has no recorded start, so its earliest view is now.
  const first = game.history ? 0 : now
  const selected = state.viewedTurn ?? now
  const edges = useScrollEdges<HTMLDivElement>()
  const list = edges.node
  useRevealRow(edges, '.history-row.current', selected)
  const select = (index: number) => {
    dispatch({ type: 'view-turn', index: index === now ? null : index })
    revealBoardIfScrolledPast()
  }
  const step = (delta: number) => {
    const index = Math.max(first, Math.min(now, selected + delta))
    select(index)
    return index
  }
  const rows = [{ index: now, turn: game.turn }, ...turns.map((turn, i) => ({ index: i + 1, turn })).reverse()]
  return (
    <section className={`${className} best-moves-panel history-panel`}
      aria-label="Turn history" onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const index = step(event.key === 'ArrowUp' ? 1 : -1)
        list?.querySelector<HTMLButtonElement>(`[data-turn="${index}"]`)?.focus({ preventScroll: true })
      }}>
      <div className="panel-heading">
        <h2>History</h2>
        <div className="panel-actions">
          <button type="button" className="panel-dots" aria-label="Earlier turn" data-label="Earlier" disabled={selected === first} onClick={() => step(-1)}><ArrowLeftGlyph /></button>
          <button type="button" className="panel-dots" aria-label="Later turn" data-label="Later" disabled={selected === now} onClick={() => step(1)}><ArrowRightGlyph /></button>
          <button type="button" className="panel-dots" aria-label="Close history" data-label="Close" onClick={() => dispatch({ type: 'history', open: false })}><CloseGlyph /></button>
        </div>
      </div>
      <div className={`history-list scroll-edges${edges.top ? ' more-above' : ''}${edges.bottom ? ' more-below' : ''}`} role="list" ref={edges.ref} onScroll={edges.onScroll}>
        {rows.map(({ index, turn }) => {
          if (!turn) return null
          const round = Math.ceil(index / game.board.players.length)
          const player = historyPlayer(game.board, turn.playerId)
          const current = selected === index
          const log = turn.log ?? []
          const produced = Object.entries(turn.gains ?? {})
          return <Fragment key={index}>
            {(index === now || round !== Math.ceil((index + 1) / game.board.players.length)) && <div className="history-round" role="presentation">Round {round}</div>}
            <div className={`history-row${current ? ' current' : ''}`} role="listitem">
              <button type="button" className="history-select" data-turn={index} aria-label={`Turn ${index}: ${player.name}`}
                aria-pressed={current} onClick={() => select(index)}>
                <PlayerDisc color={player.color}>{index}</PlayerDisc>
                <span className="history-main">
                  <span className="history-title">{player.name}{index === now && <span className="history-now">Now</span>}</span>
                  {!current && <span className="history-summary">{turnSummary(log) || (index === now ? 'Nothing recorded yet' : 'No actions')}</span>}
                </span>
                {turn.rolled !== null && <span className={`history-roll${turn.rolled === 7 ? ' seven' : ''}`} aria-label={`Rolled ${turn.rolled}`}>
                  <b>{turn.rolled}</b>{turn.rolled === 7 ? <RobberGlyph /> : <span className="history-pips" aria-hidden="true">
                    {Array.from({ length: pips(turn.rolled) }, (_, i) => <i key={i} />)}
                  </span>}
                </span>}
              </button>
              {current && <div className="history-detail">
                {turn.rolled !== null && turn.rolled !== 7 && (produced.length ? <div className="move-prod">
                  {produced.map(([id, cards]) => <ProductionPlayer key={id} player={historyPlayer(game.board, id)} cards={cards} />)}
                </div> : <div className="history-quiet">Nobody produces</div>)}
                {log.length > 0 && <ul className="move-log">{log.map((line, i) => <li key={i}><TickGlyph /><span>{line}</span></li>)}</ul>}
              </div>}
            </div>
          </Fragment>
        })}
        {game.history && <>
        <div className="history-round" role="presentation">Setup</div>
        <div className={`history-row${selected === 0 ? ' current' : ''}`} role="listitem">
          <button type="button" className="history-select" data-turn="0" aria-label="Game start" aria-pressed={selected === 0} onClick={() => select(0)}>
            <span className="history-disc start"><BoardHexGlyph color="none" /></span>
            <span className="history-main"><span className="history-title">Game start</span><span className="history-summary">Starting hands after the draft</span></span>
          </button>
        </div>
        </>}
      </div>
    </section>
  )
}
