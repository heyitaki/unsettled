import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { pips } from '../model/board'
import { historyPlayer, turnSummary } from '../model/history'
import { PLAYER_PALETTE } from '../model/types'
import { ProductionPlayer } from './BestMovesTrays'
import { readableInk } from './colors'
import { BoardHexGlyph, RobberGlyph, TickGlyph } from './glyphs'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore } from './store'

export function HistoryPanel({ className = 'panel analysis-panel' }: { className?: string }) {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  const turns = game.history?.turns ?? []
  const now = turns.length + 1
  // A game saved before history existed has no recorded start, so its earliest view is now.
  const first = game.history ? 0 : now
  const selected = state.viewedTurn ?? now
  const listRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('.history-row.current')
    if (!list || !row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
    }
    setScrolled(list.scrollTop > 0)
  }, [selected])
  const select = (index: number) => {
    dispatch({ type: 'view-turn', index: index === now ? null : index })
    revealBoardIfScrolledPast()
  }
  const rows = [{ index: now, turn: game.turn }, ...turns.map((turn, i) => ({ index: i + 1, turn })).reverse()]
  return (
    <section className={`${className} best-moves-panel history-panel${scrolled ? ' scrolled' : ''}`}
      aria-label="Turn history" onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const index = Math.max(first, Math.min(now, selected + (event.key === 'ArrowUp' ? 1 : -1)))
        select(index)
        listRef.current?.querySelector<HTMLButtonElement>(`[data-turn="${index}"]`)?.focus({ preventScroll: true })
      }}>
      <div className="panel-heading"><h2>History</h2><span className="history-count">{turns.length} {turns.length === 1 ? 'turn' : 'turns'}</span></div>
      <div className="history-list" role="list" ref={listRef} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
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
                <span className={`history-disc${player.color.toLowerCase() === PLAYER_PALETTE.white ? ' light' : ''}`} style={{ background: player.color, color: readableInk(player.color) }}>{index}</span>
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
