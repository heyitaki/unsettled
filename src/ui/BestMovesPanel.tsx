import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Cards, KnightPlay } from '../engine/advice/protocol'
import { devHandTotal, type Game } from '../model/game'
import { activePlayerId, currentTurnHistory, endTurn, recordBuyDev, setActivePlayer, turnState } from '../model/turn'
import { RESOURCES, type Resource } from '../model/types'
import { adviceResponse, useAdvice } from './useAdvice'
import {
  actionLabel, adviceBlockers, adviceMarks, applyAdvice, availableActions, limitTradeOffers, playLabel, recordedMoveLabel, robberPending, sevenDiscards, statsFor, typedDevHand, type Move,
} from './bestMoves'
import { BestMovesTable, CardAmounts } from './BestMovesTable'
import { AdviceFeedback, BestMovesTray, RobberFlow, RollStep, type Discards, type RecordedRoll, type MoveTray, type TrayKind } from './BestMovesTrays'
import { readableInk } from './colors'
import { BuildGlyph, BuyDevGlyph, PlayDevGlyph, ResourceGlyph, StepDoneGlyph, TickGlyph, TradeGlyph } from './glyphs'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore, type HighlightMark } from './store'
import { UndoRedoButtons } from './UndoRedoButtons'
import { useCoarsePointer } from './useMediaQuery'

const actionLog = new WeakMap<Game, string>()
const recordedRolls = new WeakMap<Game, RecordedRoll>()
const ACTION_TILES = [
  { kind: 'trade', label: 'Trade', Glyph: TradeGlyph },
  { kind: 'buy', label: 'Buy card', Glyph: BuyDevGlyph },
  { kind: 'play', label: 'Play card', Glyph: PlayDevGlyph },
  { kind: 'build', label: 'Build', Glyph: BuildGlyph },
] as const
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
  const [selected, setSelected] = useState<{ game: Game; id: string } | null>(null)
  const own = useRef<readonly HighlightMark[] | null>(null)
  const [, refreshRecords] = useState(0)
  const pendingRecord = useRef<{ previous: Game; text?: string; roll?: RecordedRoll } | null>(null)
  const [knight, setKnight] = useState<{ game: Game; initial?: KnightPlay } | null>(null)
  const inHistory = (entry: Game) => entry === game || tab.past.includes(entry)
  const seven = robberPending(game)
  const playingKnight = knight !== null && inHistory(knight.game)
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
  const [deck, setDeck] = useState<{ tabId: string; remaining?: number }>({ tabId: tab.id })
  const knownDeck = derived?.devDeckRemaining
  // Keep the tab's last reported deck count while a newer advice request is pending.
  if (deck.tabId !== tab.id || knownDeck !== undefined && deck.remaining !== knownDeck) setDeck({ tabId: tab.id, remaining: knownDeck })
  const deckRemaining = knownDeck ?? (deck.tabId === tab.id ? deck.remaining : undefined)

  // Build availability enumerates board slots; hover highlights re-render the panel without changing the game.
  const available = useMemo(() => activeId === null ? null : availableActions(game, activeId, deckRemaining),
    [game, activeId, deckRemaining])
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
    setKnight(null)
    dispatch({ type: 'pick-clear' })
    mark(null)
  }, [dispatch, mark])
  const previousTab = useRef(tab)
  useLayoutEffect(() => {
    const previous = previousTab.current
    previousTab.current = tab
    if (previous.id !== tab.id || activePlayerId(previous.game) !== activeId ||
      previous.game !== game && (game === previous.past.at(-1) || game === previous.future[0])) close()
  }, [tab, game, activeId, close])
  const record = useCallback((next: Game, text: string) => {
    if (next === game) return
    pendingRecord.current = { previous: game, text }
    commit(next)
  }, [game, commit])
  useLayoutEffect(() => {
    const pending = pendingRecord.current
    if (!pending || game === pending.previous) return
    pendingRecord.current = null
    if (tab.past.at(-1) !== pending.previous) return

    // Award changes can replace the submitted game, so retain the store's committed snapshot.
    if (pending.text) actionLog.set(game, pending.text)
    if (pending.roll) recordedRolls.set(game, pending.roll)
    refreshRecords((value) => value + 1)
  }, [game, tab.past])
  const rolled = useCallback((gains: Record<string, Cards> | null, discards: Discards) => {
    pendingRecord.current = { previous: game, roll: { gains, discards, skipped: new Set() } }
    close()
  }, [game, close])
  useEffect(() => {
    if (!seven && !playingKnight) mark(null)
  }, [game, seven, playingKnight, mark])
  useEffect(() => () => dispatch({ type: 'highlight', marks: null }), [dispatch])
  useEffect(() => {
    if (state.highlight !== own.current) setSelected(null)
  }, [state.highlight])
  const pinned = seven || playingKnight || (selected?.game === game) || (state.highlight !== null && state.highlight !== own.current)
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
    close()
    if (!('open' in result)) record(result, recordedMoveLabel(move))
    else if (result.open === 'play' && result.fill.type === 'playKnight') setKnight({ game, initial: result.fill })
    else setTray({ kind: result.open, fill: result, id: ++traySequence.current })
  }
  const toggleTray = (kind: TrayKind) => {
    const open = tray?.kind !== kind && !(kind === 'play' && playingKnight)
    clear()
    close()
    if (!open) return
    if (kind === 'buy' && !mine) record(recordBuyDev(game, null), recordedMoveLabel({ type: 'buyDev' }))
    else setTray({ kind, id: ++traySequence.current })
  }
  const finishTurn = () => {
    commit(endTurn(game))
    close()
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
  const devHand = typedDevHand(game, activeId)
  const typedDevCards = devHand ? devHandTotal(devHand) : 0
  const tiles = ACTION_TILES.filter(({ kind }) => !seven && available?.[kind])
  const noActions = !before && !seven && tray === null && !playingKnight && tiles.length === 0
  const turnGames = currentTurnHistory([...tab.past, game])
  const actions = turnGames.flatMap((entry) => actionLog.has(entry) ? [actionLog.get(entry)!] : [])
  const rollIndex = turnGames.findIndex((entry) => turnState(entry)?.rolled != null)
  const rollGame = turnGames[rollIndex]
  // Change roll recommits the pre-roll snapshot as a new step, so Undo brings the roll and its actions back.
  const beforeRoll = rollIndex > 0 ? turnGames[rollIndex - 1] : undefined
  let roll = rollGame && recordedRolls.get(rollGame)
  if (rollGame && !roll) {
    roll = { discards: sevenDiscards(rollGame), skipped: new Set() }
    recordedRolls.set(rollGame, roll)
  }
  return (
    <>
      <section className={`${className} best-moves-panel`}>
        <div className="panel-heading">
          <h2>{mine ? 'Record your turn' : `Record ${active.name}'s turn`}</h2>
          <UndoRedoButtons />
        </div>
        {order}
        <p className="analysis-context move-context">
          <strong>{active.name}</strong>
          {' · '}
          {turn?.rolled == null ? 'not rolled yet' : `Rolled ${turn.rolled}`}
        </p>
        <BestMovesTable game={game} activeId={activeId} commit={commit} />
        <ol className="move-steps">
          <li className={`move-step ${before ? 'now' : 'done'}`}>
            <span className="move-step-dot" aria-hidden="true">{before ? '1' : <StepDoneGlyph />}</span>
            <div className="move-step-body">
              <RollStep key={`${tab.id}:${activeId}`} game={game} active={active} adviceEnabled={adviceEnabled} commit={commit}
                rolled={rolled} recordedRoll={roll} record={record} mark={mark} finish={close}
                changeRoll={beforeRoll && (() => { close(); commit(beforeRoll) })} />
            </div>
          </li>
          <li className={`move-step ${noActions ? 'done' : before || seven ? 'later' : 'now'}`}>
            <span className="move-step-dot" aria-hidden="true">{noActions ? <StepDoneGlyph /> : '2'}</span>
            <div className="move-step-body">
              <div className="move-step-title">{noActions ? 'No actions possible' : 'Actions'}</div>
              {actions.length > 0 && <ul className="move-log">{actions.map((text, index) => <li key={index}><TickGlyph /><span>{text}</span></li>)}</ul>}
              {tiles.length > 0 && <div className="move-tiles">
                {tiles.map(({ kind, label, Glyph }) => (
                  <button type="button" className="move-tile" key={kind} aria-pressed={tray?.kind === kind} onClick={() => toggleTray(kind)}>
                    <Glyph /><span>{label}</span>
                  </button>
                ))}
              </div>}
              {tray && <BestMovesTray key={tray.id} game={game} active={active} tray={tray} adviceEnabled={adviceEnabled}
                commit={record} close={close} knight={() => { close(); setKnight({ game }) }} />}
              {playingKnight && <RobberFlow game={game} active={active} adviceEnabled={adviceEnabled} mark={mark}
                commit={record} finish={close} knight initial={knight.initial} />}
            </div>
          </li>
          <li className={`move-step ${before ? 'later' : 'now'}`}>
            <span className="move-step-dot" aria-hidden="true">3</span>
            <div className="move-step-body"><button type="button" className="primary move-end-turn" onClick={finishTurn}>End turn</button></div>
          </li>
        </ol>
      </section>
      <section className={`${className} best-moves-panel`}>
        <div className="panel-heading"><h2>Best moves</h2></div>
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
          {unknown > 0 && <li>Bank estimated: {unknown} cards of unknown type</li>}
          {derived && derived.unknownOwnCards > 0 && (
            <li>{derived.unknownOwnCards} of {active.name}'s cards are of unknown type and ignored</li>
          )}
          {!mine && devCards > 0 && <li>{active.name}'s {devCards} dev cards are treated as unplayed knights</li>}
          {mine && devCards > typedDevCards && <li>Set your dev cards by type in the table</li>}
        </ul>
      </section>
    </>
  )
}
