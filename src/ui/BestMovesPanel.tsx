import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Cards, KnightPlay } from '../engine/advice/protocol'
import type { Game } from '../model/game'
import { activePlayerId, appendLog, currentTurnHistory, endTurn, recordBuyDev, setActivePlayer, turnState } from '../model/turn'
import { RESOURCES, type Resource } from '../model/types'
import { adviceResponse, useAdvice } from './useAdvice'
import {
  actionLabel, adviceBlockers, adviceMarks, applyAdvice, availableActions, limitTradeOffers, playLabel, recordedMoveLabel, robberPending, sevenDiscards, statsFor, type Move,
} from './bestMoves'
import { CardAmounts } from './MoveInputs'
import { Ledger } from './Ledger'
import { HistoryPanel } from './HistoryPanel'
import { AdviceFeedback, BestMovesTray, RobberFlow, RollStep, type Discards, type RecordedRoll, type MoveTray, type TrayKind } from './BestMovesTrays'
import { readableInk } from './colors'
import { BuildGlyph, BuyDevGlyph, PlayDevGlyph, ResourceGlyph, StepDoneGlyph, TickGlyph, TradeGlyph, UndoGlyph } from './glyphs'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore, type HighlightMark } from './store'
import { UndoRedoButtons } from './UndoRedoButtons'
import { useCoarsePointer } from './useMediaQuery'

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
  const viewed = board.players.find((player) => player.id === state.viewedPlayer) ?? active
  const viewedId = viewed?.id ?? null
  const viewingTurn = viewedId === activeId
  const viewingMine = viewedId === board.mePlayerId
  const color = viewed?.color ?? '#8a7a63'
  const coarse = useCoarsePointer()
  const [tray, setTray] = useState<(MoveTray & { id: number }) | null>(null)
  const traySequence = useRef(0)
  const [selected, setSelected] = useState<{ game: Game; id: string } | null>(null)
  const own = useRef<readonly HighlightMark[] | null>(null)
  const [, refreshRecords] = useState(0)
  const pendingRecord = useRef<{ previous: Game; roll: RecordedRoll } | null>(null)
  const [knight, setKnight] = useState<{ game: Game; initial?: KnightPlay } | null>(null)
  const inHistory = (entry: Game) => entry === game || tab.past.includes(entry)
  const seven = robberPending(game)
  const playingKnight = knight !== null && inHistory(knight.game)
  const before = turn?.rolled === null
  const blockers = useMemo(() => adviceBlockers(board), [board])
  const adviceEnabled = blockers.length === 0 && !state.historyOpen
  const moves = useAdvice(
    adviceEnabled && viewedId !== null && !seven && (!viewingTurn || !before) ? { kind: 'turn' } : null,
    viewedId,
  )
  const pre = useAdvice(
    adviceEnabled && viewingTurn && activeId !== null && !seven && (before || !turn?.devPlayed) ? { kind: 'preRoll' } : null,
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
    commit(appendLog(next, text))
  }, [game, commit])
  useLayoutEffect(() => {
    const pending = pendingRecord.current
    if (!pending || game === pending.previous) return
    pendingRecord.current = null
    if (tab.past.at(-1) !== pending.previous) return

    // Award changes can replace the submitted game, so retain the store's committed snapshot.
    recordedRolls.set(game, pending.roll)
    refreshRecords((value) => value + 1)
  }, [game, tab.past])
  const rolled = useCallback((gains: Record<string, Cards> | null, discards: Discards) => {
    pendingRecord.current = { previous: game, roll: { gains, discards, skipped: new Set() } }
    close()
  }, [game, close])
  useEffect(() => {
    if (!seven && !playingKnight) mark(null)
  }, [game, seven, playingKnight, mark])
  useEffect(() => {
    setSelected(null)
    if (!seven && !playingKnight) mark(null)
  }, [viewedId, seven, playingKnight, mark])
  useEffect(() => () => dispatch({ type: 'highlight', marks: null }), [dispatch])
  useEffect(() => () => dispatch({ type: 'history', open: false }), [dispatch])
  useLayoutEffect(() => {
    if (state.historyOpen) close()
  }, [state.historyOpen, close])
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
    if (!('open' in result)) {
      if (move.type === 'pass') commit(result)
      else record(result, recordedMoveLabel(move))
    }
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
  const cards: MoveCard[] = []

  // After rolling, knights already appear among the ranked moves.
  if (preRoll && preRoll.play !== null && (before || preRoll.play.type !== 'playKnight')) {
    cards.push({
      id: 'preRoll',
      title: before ? mine ? 'Before you roll' : `Before ${active?.name} rolls` : 'Dev card',
      move: preRoll.play,
      label: playLabel(preRoll.play, board),
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
  const claimNote = board.mePlayerId === null ? <li>Claim yourself in Players to track your exact cards</li> : null
  const ledger = (
    <section className={`${className} best-moves-panel ledger-panel`}>
      <Ledger game={game} activeId={activeId} previous={tab.past.at(-1)} commit={commit} onUndo={() => dispatch({ type: 'undo' })}
        historyOpen={state.historyOpen} viewedTurn={state.viewedTurn} onToggleHistory={() => dispatch({ type: 'history', open: !state.historyOpen })} />
    </section>
  )
  if (state.historyOpen && game.turn) return <>{ledger}<HistoryPanel className={className} /></>
  if (!active || activeId === null || !viewed || viewedId === null) return (
    <>
      {ledger}
      <section className={`${className} best-moves-panel`}>
        <div className="panel-heading">
          <h2>Best moves</h2>
        </div>
        <button type="button" className="primary" onClick={() => commit(setActivePlayer(game, board.players[0].id))}>Start game</button>
        <ul className="move-notes">{claimNote}</ul>
      </section>
    </>
  )
  const devCards = statsFor(game, viewedId).devCards
  const tiles = ACTION_TILES.filter(({ kind }) => !seven && available?.[kind])
  const noActions = !before && !seven && tray === null && !playingKnight && tiles.length === 0
  const turnGames = currentTurnHistory([...tab.past, game])
  const actions = turn?.log ?? []
  const previous = tab.past.at(-1)
  const previousTurn = previous && turnState(previous)
  const undoLog = previousTurn?.playerId === turn?.playerId && (previousTurn?.log?.length ?? 0) === actions.length - 1
    && (previousTurn?.log ?? []).every((line, index) => line === actions[index])
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
      {ledger}
      <section className={`${className} best-moves-panel`}>
        <div className="panel-heading">
          <h2>{mine ? 'Record your turn' : `Record ${active.name}'s turn`}</h2>
          <UndoRedoButtons />
        </div>
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
              {actions.length > 0 && <ul className="move-log">{actions.map((text, index) => <li key={index}>
                <TickGlyph /><span>{text}</span>
                {index === actions.length - 1 && undoLog && <button type="button" className="move-log-undo" onClick={() => dispatch({ type: 'undo' })}><UndoGlyph />Undo</button>}
              </li>)}</ul>}
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
        <div className="panel-heading"><h2>{viewingMine ? 'Best moves' : `Best moves for ${viewed.name}`}</h2></div>
        {!viewingTurn && <p className="hint">
          {viewingMine
            ? 'Not your turn. These are the moves you would make with this hand if your turn started now.'
            : `Not ${viewed.name}'s turn. These are the moves ${viewed.name} would make with this hand if their turn started now.`}
        </p>}
        {!adviceEnabled ? (
          <div className="hint">
            <p>Finish the board to get advice:</p>
            <ul>{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>
        ) : seven ? (
          <p className="hint">Record the discards and the robber above. The ranked moves follow.</p>
        ) : (
          <>
            <AdviceFeedback advice={viewingTurn && before ? pre : moves} />
            {viewingTurn && !before && !turn?.devPlayed && pre.status === 'error' && moves.status !== 'error' && (
              <AdviceFeedback advice={pre} />
            )}
            {cards.length > 0 && <div className="analysis-list pick-ledger" onMouseLeave={() => preview(null)}>
              {cards.map((card) => {
                const current = selected?.game === game && selected.id === card.id
                const applyCard = () => { if (card.move) apply(card.move) }
                const previewCard = () => preview(card.move ? adviceMarks(card.move, color) : null)
                return (
                  <div
                    key={card.id}
                    className={`analysis-row${card.title ? ' move-pre' : ''}${current ? ' current' : ''}`}
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
                    {card.title && <button type="button" className="move-play" aria-label={card.label} onClick={applyCard}>Play</button>}
                    {!card.title && current && card.move && (
                      <div className="analysis-touch-actions">
                        {viewingTurn && <button type="button" className="primary" onClick={applyCard}>
                          {card.move.type === 'pass'
                            ? 'End turn'
                            : card.move.type === 'offerTrade' ? 'Apply: who accepted?' : 'Apply'}
                        </button>}
                        <button type="button" onClick={clear}>Clear</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>}
            {before && preRoll && <p className="move-empty">
              {/* The engine answers null after a pre-roll play too, since only one dev card is allowed per turn. */}
              {preRoll.play === null && !turn?.devPlayed && <><b>No dev card worth playing first.</b>{' '}</>}
              Ranked trades, builds and cards follow the roll.
            </p>}
          </>
        )}
        <ul className="move-notes">
          {claimNote}
          {derived && derived.unknownOwnCards > 0 && (
            <li>{derived.unknownOwnCards} of {viewed.name}'s cards are of unknown type and ignored</li>
          )}
          {!viewingMine && devCards > 0 && <li>{viewed.name}'s {devCards} dev cards are treated as unplayed knights</li>}
        </ul>
      </section>
    </>
  )
}
