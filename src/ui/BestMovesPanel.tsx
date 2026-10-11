import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cards } from '../engine/advice/protocol'
import { devHandTotal, type Game } from '../model/game'
import { activePlayerId, endTurn, setActivePlayer, turnState } from '../model/turn'
import { RESOURCES, type Resource } from '../model/types'
import { adviceResponse, useAdvice } from './useAdvice'
import {
  actionLabel, adviceBlockers, adviceMarks, applyAdvice, limitTradeOffers, playLabel, statsFor, type Move,
} from './bestMoves'
import { BestMovesTable, CardAmounts } from './BestMovesTable'
import { AdviceFeedback, BestMovesTray, type Discards, type MoveTray, type TrayKind } from './BestMovesTrays'
import { readableInk } from './colors'
import { ArrowLeftGlyph, ArrowRightGlyph, ResourceGlyph } from './glyphs'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore, type HighlightMark } from './store'
import { useCoarsePointer } from './useMediaQuery'

const EMPTY_DISCARDS: Discards = []
const RESOURCE_WORDS = new RegExp(`\\b(${RESOURCES.join('|')})\\b`, 'g')

interface MoveCard {
  id: string
  rank?: number
  title?: string
  move: Move | null
  label: string
  reason: string
  score?: number
  handDelta?: Cards
}

function MoveText({ text }: { text: string }) {
  return (
    <span role="img" aria-label={text}>
      {text.split(RESOURCE_WORDS).map((part, index) =>
        (RESOURCES as readonly string[]).includes(part)
          ? <ResourceGlyph key={index} resource={part as Resource} />
          : part)}
    </span>
  )
}

export function BestMovesPanel({ className = 'panel analysis-panel' }: { className?: string }) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const game = tab.game
  const { board } = game
  const activeId = activePlayerId(game)
  const turn = turnState(game)
  const active = board.players.find((player) => player.id === activeId)
  const mine = activeId === board.mePlayerId
  const color = active?.color ?? '#8a7a63'
  const coarse = useCoarsePointer()
  const [tray, setTray] = useState<(MoveTray & { id: number }) | null>(null)
  const traySequence = useRef(0)
  const [rollSummary, setRollSummary] = useState<{ game: Game; text: string } | null>(null)
  const [discards, setDiscards] = useState<Discards>(EMPTY_DISCARDS)
  const [selected, setSelected] = useState<{ game: Game; id: string } | null>(null)
  const own = useRef<readonly HighlightMark[] | null>(null)
  const seven = turn?.rolled === 7 && tray?.kind === 'roll'
  const before = turn?.rolled === null
  const blockers = useMemo(() => adviceBlockers(board), [board])
  const adviceEnabled = blockers.length === 0
  const moves = useAdvice(
    adviceEnabled && activeId !== null && !before && !seven ? { kind: 'turn' } : null,
    activeId,
  )
  const pre = useAdvice(
    adviceEnabled && activeId !== null && !seven && (before || !turn?.devPlayed) ? { kind: 'preRoll' } : null,
    activeId,
  )
  const ranked = adviceResponse(moves.response, 'turn')
  const preRoll = adviceResponse(pre.response, 'preRoll')
  const derived = ranked?.derived ?? preRoll?.derived
  const mark = useCallback((marks: HighlightMark[] | null) => {
    own.current = marks
    dispatch({ type: 'highlight', marks })
  }, [dispatch])
  const clear = () => {
    setSelected(null)
    mark(null)
  }
  const commit = useCallback((next: Game) => dispatch({ type: 'commit-game', game: next }), [dispatch])
  const close = useCallback(() => {
    setTray(null)
    dispatch({ type: 'pick-clear' })
    mark(null)
  }, [dispatch, mark])
  useEffect(() => {
    close()
    setDiscards(EMPTY_DISCARDS)
  }, [tab.id, activeId, close])
  const rolled = useCallback((next: Game, text: string, discards: Discards) => {
    setRollSummary({ game: next, text })
    setDiscards(discards)
  }, [])
  useEffect(() => {
    mark(null)
    return () => dispatch({ type: 'highlight', marks: null })
  }, [game, mark, dispatch])
  useEffect(() => {
    if (state.highlight !== own.current) setSelected(null)
  }, [state.highlight])
  const pinned = (selected?.game === game) || (state.highlight !== null && state.highlight !== own.current)
  const preview = (marks: HighlightMark[] | null) => { if (!coarse && !pinned) mark(marks) }
  const select = (card: MoveCard) => {
    const next = selected?.game === game && selected.id === card.id ? null : { game, id: card.id }
    setSelected(next)
    mark(next && card.move ? adviceMarks(card.move, color) : null)
    if (next) revealBoardIfScrolledPast()
  }
  const apply = (move: Move) => {
    const result = applyAdvice(game, move)
    clear()
    if ('open' in result) setTray({ kind: result.open, fill: result, id: ++traySequence.current })
    else {
      commit(result)
      close()
    }
  }
  const toggleTray = (kind: TrayKind) => {
    clear()
    if (tray?.kind === kind) close()
    else setTray({ kind, id: ++traySequence.current })
  }
  const finishTurn = () => {
    commit(endTurn(game))
    close()
  }
  const markTray = (marks: HighlightMark[] | null) => {
    setSelected(marks ? { game, id: 'robber' } : null)
    mark(marks)
    if (marks) revealBoardIfScrolledPast()
  }
  const selectPlayer = (id: string) => {
    if (activeId !== id) commit(setActivePlayer(game, id))
  }
  const cards: MoveCard[] = []

  // After rolling, knights already appear among the ranked moves.
  if (preRoll && (before || (preRoll.play !== null && preRoll.play.type !== 'playKnight'))) {
    cards.push({
      id: 'preRoll',
      title: before ? mine ? 'Before you roll' : `Before ${active?.name} rolls` : 'Dev card',
      move: preRoll.play,
      label: preRoll.play ? playLabel(preRoll.play, board) : 'Hold your dev cards',
      reason: preRoll.reason,
    })
  }
  for (const [index, advice] of limitTradeOffers(ranked?.actions ?? []).entries()) {
    cards.push({
      id: `move:${index}`,
      rank: index + 1,
      move: advice.action,
      label: actionLabel(advice.action, board),
      reason: advice.reason,
      score: advice.score,
      handDelta: advice.handDelta,
    })
  }
  const unknown = board.players.reduce((sum, player) => sum + statsFor(game, player.id).handUnknown, 0)
  const order = (
    <div className="move-order" role="group" aria-label="Turn order">
      {board.players.map((player, index) => (
        <button
          type="button"
          key={player.id}
          className="move-seat"
          style={{ background: player.color, color: readableInk(player.color) }}
          aria-pressed={activeId === player.id}
          aria-label={`Turn ${index + 1}: ${player.name}`}
          title={`Turn ${index + 1}: ${player.name}`}
          onClick={() => selectPlayer(player.id)}
        >
          {index + 1}
        </button>
      ))}
    </div>
  )
  const claimNote = board.mePlayerId === null ? <li>Claim yourself in Players to track your exact cards</li> : null
  if (!active || activeId === null) return (
    <section className={`${className} best-moves-panel`}>
      <div className="panel-heading">
        <h2>Best moves</h2>
      </div>
      {order}
      <p className="hint">Tap a player to start tracking turns</p>
      <ul className="move-notes">{claimNote}</ul>
    </section>
  )
  const devCards = statsFor(game, activeId).devCards
  const devHand = game.devHand?.playerId === activeId ? game.devHand : undefined
  const typedDevCards = devHand ? devHandTotal(devHand) : 0
  const bar: [TrayKind, string][] = [
    ['roll', turn?.rolled == null ? 'Roll' : `Rolled ${turn.rolled}`],
    ['trade', 'Trade'],
    ['build', 'Build'],
    ['buy', 'Buy dev card'],
    ['play', 'Play dev card'],
  ]
  return (
    <section className={`${className} best-moves-panel`}>
      <div className="panel-heading">
        <div>
          <span className="move-turn">{mine ? 'Your turn' : `${active.name}'s turn`}</span>
          <h2>Best moves</h2>
        </div>
        <div className="draft-steps">
          <button
            type="button"
            className="draft-step"
            aria-label="Undo"
            title="Undo"
            disabled={tab.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <ArrowLeftGlyph />
          </button>
          <button
            type="button"
            className="draft-step"
            aria-label="Redo"
            title="Redo"
            disabled={tab.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <ArrowRightGlyph />
          </button>
        </div>
      </div>
      {order}
      <p className="analysis-context move-context">
        <strong>{active.name}</strong>
        {' · '}
        {rollSummary?.game === game
          ? rollSummary.text
          : turn?.rolled == null ? 'not rolled yet' : `Rolled ${turn.rolled}`}
      </p>
      <BestMovesTable game={game} activeId={activeId} commit={commit} />
      <div className="move-label">
        <span>{mine ? 'Record your turn' : `Record ${active.name}'s turn`}</span>
      </div>
      <div className="move-bar">
        {bar.map(([kind, label]) => (
          <button type="button" key={kind} aria-pressed={tray?.kind === kind} onClick={() => toggleTray(kind)}>
            {label}
          </button>
        ))}
        <button type="button" onClick={finishTurn}>End turn</button>
      </div>
      {/* Each opening needs fresh inputs, including when Apply opens the same tray with a different move. */}
      {tray && (
        <BestMovesTray
          key={tray.id}
          game={game}
          active={active}
          tray={tray}
          adviceEnabled={adviceEnabled}
          discards={discards}
          commit={commit}
          close={close}
          rolled={rolled}
          mark={markTray}
        />
      )}
      <div className="move-label">
        <span>{mine ? 'Your best moves' : `Best moves for ${active.name}`}</span>
      </div>
      {!adviceEnabled ? (
        <div className="hint">
          <p>Finish the board to get advice:</p>
          <ul>{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : seven ? (
        <p className="hint">Record the discards and the robber above. The ranked moves follow.</p>
      ) : (
        <>
          <AdviceFeedback advice={before ? pre : moves} />
          {!before && !turn?.devPlayed && pre.status === 'error' && moves.status !== 'error' && (
            <AdviceFeedback advice={pre} />
          )}
          <div className="analysis-list" onMouseLeave={() => preview(null)}>
            {cards.map((card) => {
              const current = selected?.game === game && selected.id === card.id
              const applyCard = () => { if (card.move) apply(card.move) }
              const previewCard = () => preview(card.move ? adviceMarks(card.move, color) : null)
              return (
                <div
                  key={card.id}
                  className={`analysis-row${card.title ? ' move-dashed' : ''}${current ? ' current' : ''}`}
                >
                  <button
                    type="button"
                    className="analysis-row-select"
                    aria-pressed={current}
                    onClick={() => select(card)}
                    onMouseEnter={previewCard}
                  >
                    {!card.title && (
                      <span className="analysis-rank" style={{ background: color, color: readableInk(color) }}>
                        {card.rank}
                      </span>
                    )}
                    <span className="analysis-row-body">
                      {card.title && <span className="analysis-likely-gone-title">{card.title}</span>}
                      <span className="analysis-pick-line">
                        <strong><MoveText text={card.label} /></strong>
                        {card.score !== undefined && (
                          <span className="analysis-score">
                            {card.score.toLocaleString('en-US', {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}
                          </span>
                        )}
                      </span>
                      {card.reason && <span className="move-reason">{card.reason}</span>}
                      {card.handDelta && RESOURCES.some((resource) => card.handDelta?.[resource] !== 0) && (
                        <span className={`analysis-factors move-costs${current ? ' expanded' : ''}`}>
                          <CardAmounts cards={card.handDelta} signed />
                        </span>
                      )}
                    </span>
                  </button>
                  {current && card.move && (
                    <div className="analysis-touch-actions">
                      <button type="button" className="primary" onClick={applyCard}>
                        {card.move.type === 'pass'
                          ? 'End turn'
                          : card.move.type === 'offerTrade' ? 'Apply: who accepted?' : 'Apply'}
                      </button>
                      <button type="button" onClick={clear}>Clear</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      <ul className="move-notes">
        {claimNote}
        {derived && <li>Dev deck: {derived.devDeckRemaining} left</li>}
        {unknown > 0 && <li>Bank estimated: {unknown} cards of unknown type</li>}
        {derived && derived.unknownOwnCards > 0 && (
          <li>{derived.unknownOwnCards} of {active.name}'s cards are of unknown type and ignored</li>
        )}
        {!mine && devCards > 0 && <li>{active.name}'s {devCards} dev cards are treated as unplayed knights</li>}
        {mine && devCards > typedDevCards && <li>Set your dev cards by type in the table</li>}
        <li>Super cities count for production and points but are never suggested</li>
      </ul>
    </section>
  )
}
