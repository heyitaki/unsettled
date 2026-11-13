import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AdviceResponse, Cards, KnightPlay } from '../engine/advice/protocol'
import { pips } from '../model/board'
import { axialKey, parseAxialKey } from '../model/coords'
import { DEV_KINDS, emptyStats, type DevKind, type Game } from '../model/game'
import {
  bankPorts, bankRate, CARD_COSTS, handTotal, isValidBankTrade, recordBankTrade, recordBuild, recordBuyDev, recordDiscard,
  recordPlayDev, recordPlayerTrade, recordRobber, recordRoll, turnState, type DevPlay,
} from '../model/turn'
import { RESOURCES, type AxialCoord, type EdgeId, type Player, type Resource, type VertexId } from '../model/types'
import { adviceResponse, useAdvice, useAdviceClient, type AdviceState } from './useAdvice'
import {
  adviceMarks, buildablePieces, canCover, cardRange, DEV_LABELS, discardInputCards, hexLabel, recordedMoveLabel, robberCandidates, robberPending, sevenDiscards, statsFor, tradeVerdictRequest, typedDevHand, type AdviceInput,
} from './bestMoves'
import { CardAmounts, MoveStepper, ResourcePicker } from './MoveInputs'
import { CheckGlyph, DevChipGlyph, EraserGlyph, MinusGlyph, PencilGlyph, ResourceGlyph, RobberGlyph, StructureGlyph } from './glyphs'
import { placeBelow } from './overlayPosition'
import { useStore, type HighlightMark } from './store'
import { useBoardPick } from './useBoardPick'

export type TrayKind = 'trade' | 'build' | 'buy' | 'play'
export interface MoveTray { kind: TrayKind; fill?: AdviceInput }
export type Discards = ReturnType<typeof sevenDiscards>
export interface RecordedRoll {
  /** Production the engine added: null when it failed, absent when the roll was not recorded in this session. */
  gains?: Record<string, Cards> | null
  discards: Discards
  /** Players whose discard the user skipped. */
  skipped: Set<string>
}
interface TrayProps {
  game: Game
  active: Player
  tray: MoveTray
  adviceEnabled: boolean
  commit(game: Game, text: string): void
  close(): void
  knight(): void
}

export function AdviceFeedback({ advice }: { advice: AdviceState }) {
  if (advice.status === 'pending') return <p className="hint" role="status">Getting advice…</p>
  if (advice.response && 'error' in advice.response) return (
    <div className="move-advice-error" role="alert">
      <p>{advice.response.error}</p>
      <button type="button" onClick={advice.retry}>Retry advice</button>
    </div>
  )
  return null
}

export function BestMovesTray(props: TrayProps) {
  switch (props.tray.kind) {
    case 'trade': return <TradeTray {...props} />
    case 'build': return <BuildTray {...props} />
    case 'buy': return <BuyTray {...props} />
    case 'play': return <PlayTray {...props} />
  }
}

export function RollStep({ game, active, adviceEnabled, commit, rolled, recordedRoll, changeRoll, record, mark, finish }: {
  game: Game
  active: Player
  adviceEnabled: boolean
  commit(game: Game): void
  rolled(gains: Record<string, Cards> | null, discards: Discards): void
  recordedRoll?: RecordedRoll
  mark(marks: HighlightMark[] | null): void
  finish(): void
  changeRoll?: () => void
  record(game: Game, text: string): void
}) {
  const client = useAdviceClient()
  const { dispatch } = useStore()
  const [rolling, setRolling] = useState<{ game: Game; total: number } | null>(null)
  const [, refreshDiscards] = useState(0)
  const gains = recordedRoll?.gains
  const current = useRef(game)
  current.current = game
  useEffect(() => {
    if (!rolling || rolling.game !== game) return
    let live = true
    const production: Promise<AdviceResponse> = adviceEnabled
      ? client.request({ game, observer: active.id, decision: { kind: 'produce', total: rolling.total } })
      : Promise.resolve({ error: 'Finish the board to get advice' })
    void production.then((response) => {
      if (!live || current.current !== game) return
      const gains = adviceResponse(response, 'produce')?.gains ?? null
      const next = recordRoll(game, rolling.total, gains ?? {})
      rolled(gains, [])
      commit(next)
      setRolling(null)
      if (gains === null) dispatch({ type: 'notice', message: 'Production not added: enter the cards by hand' })
    })
    return () => { live = false }
  }, [rolling, game, active.id, adviceEnabled, client, dispatch, commit, rolled])
  const outstanding = recordedRoll?.discards.filter(({ playerId, total, count }) =>
    !recordedRoll.skipped.has(playerId) && handTotal(statsFor(game, playerId)) > total - count) ?? []
  const roll = (total: number) => {
    if (total !== 7) {
      setRolling({ game, total })
      return
    }
    const next = recordRoll(game, 7, {})
    rolled({}, sevenDiscards(game))
    commit(next)
  }
  const produced = game.board.players.flatMap((player) => {
    const cards = gains && Object.hasOwn(gains, player.id) ? gains[player.id] : null
    return cards && RESOURCES.some((resource) => cards[resource] > 0) ? [{ player, cards }] : []
  })
  const total = turnState(game)?.rolled
  return (
    <>
      <div className="move-step-title">
        <span>{total == null ? 'Roll' : `Rolled ${total}`}</span>
        {total != null && changeRoll && <button type="button" className="icon-btn" aria-label="Change roll" title="Change roll" onClick={changeRoll}><PencilGlyph /></button>}
      </div>
      {total != null && gains !== undefined && <div className="move-prod">
          {gains === null ? 'Production not added: enter the cards by hand' : produced.length ? produced.map(({ player, cards }) => (
            <span className="move-prod-player" key={player.id}>
              <span className="swatch" style={{ background: player.color }} />
              {player.name}
              <span className="move-prod-cards" role="img" aria-label={RESOURCES.filter((resource) => cards[resource] > 0).map((resource) => `${cards[resource]} ${resource}`).join(', ')}>
                {RESOURCES.flatMap((resource) => Array.from({ length: cards[resource] }, (_, index) => <ResourceGlyph key={`${resource}:${index}`} resource={resource} />))}
              </span>
            </span>
          )) : 'Nobody produces'}
        </div>}
      {total == null && (
        <div className="move-dice" role="group" aria-label="Dice total">
          {Array.from({ length: 11 }, (_, index) => index + 2).map((total) => (
            <button type="button" key={total} disabled={rolling?.game === game} onClick={() => roll(total)}>
              {total}
              {total === 7 ? <RobberGlyph className="seven-robber" /> : (
                <svg className="dice-pips" viewBox="0 0 30 4" width="30" height="4" aria-hidden="true">
                  {Array.from({ length: pips(total) }, (_, index) => (
                    <circle key={index} cx={15 + (index - (pips(total) - 1) / 2) * 4} cy="2" r="1.3" fill="currentColor" />
                  ))}
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
      {rolling?.game === game && <p role="status">Adding production…</p>}
      {robberPending(game) && (
        <>
          {outstanding.map((entry) => (
            <DiscardLine
              key={entry.playerId}
              game={game}
              adviceEnabled={adviceEnabled}
              {...entry}
              commit={record}
              skip={() => { recordedRoll?.skipped.add(entry.playerId); refreshDiscards((value) => value + 1) }}
            />
          ))}
          {outstanding.length === 0 && <RobberFlow game={game} active={active} adviceEnabled={adviceEnabled}
            mark={mark} commit={record} finish={finish} />}
        </>
      )}
    </>
  )
}

function DiscardLine({ game, playerId, total, count, adviceEnabled, commit, skip }: {
  game: Game
  adviceEnabled: boolean
  playerId: string
  total: number
  count: number
  commit(game: Game, text: string): void
  skip(): void
}) {
  const me = playerId === game.board.mePlayerId
  const advice = useAdvice(adviceEnabled && me ? { kind: 'discard' } : null, playerId)
  const response = adviceResponse(advice.response, 'discard')
  const [typed, setTyped] = useState(false)
  const [cards, setCards] = useState<Cards>(() => emptyStats().hand)
  const manual = typed || (me && (!adviceEnabled || advice.status === 'error'))
  const selected = manual ? cards : response?.cards
  const sum = selected ? RESOURCES.reduce((sum, resource) => sum + selected[resource], 0) : 0
  const name = game.board.players.find((player) => player.id === playerId)?.name ?? playerId
  const record = () => commit(recordDiscard(game, playerId, me || manual ? selected ?? {} : count), `${name} discarded ${count} cards`)
  const enterTypes = () => {
    setCards(discardInputCards(me, response?.cards))
    setTyped(true)
  }
  return (
    <div className="move-discard" role="group" aria-label={`${name}'s discard`}>
      <div className="move-pick">
        <span><b>{name}</b> · {total} cards</span>
        {!me && !manual ? <span>discards {count}, types not seen</span> : <span>Discard {count}</span>}
        {me && !manual && response && <CardAmounts cards={response.cards} />}
        <button type="button" className="primary" disabled={(me || manual) && sum !== count} onClick={record}>
          Record
        </button>
        {!manual && <button type="button" onClick={enterTypes}>Enter types</button>}
        <button type="button" onClick={skip}>Skip</button>
      </div>
      {manual && (
        <div className="move-chips">
          {RESOURCES.map((resource) => (
            <MoveStepper
              key={resource}
              label={resource}
              value={cards[resource]}
              max={count}
              onChange={(value) => setCards({ ...cards, [resource]: value })}
            />
          ))}
          <span>{sum} / {count}</span>
        </div>
      )}
      {me && adviceEnabled && <AdviceFeedback advice={advice} />}
      {me && response?.reason && !manual && <p>{response.reason}</p>}
    </div>
  )
}

export function RobberFlow({ game, active, adviceEnabled, initial, mark, commit, finish, knight = false }: {
  game: Game
  active: Player
  adviceEnabled: boolean
  initial?: KnightPlay
  knight?: boolean
  mark(marks: HighlightMark[] | null): void
  commit(game: Game, text: string): void
  finish(): void
}) {
  const me = game.board.mePlayerId
  const advice = useAdvice(adviceEnabled && active.id === me && initial === undefined ? { kind: 'robber' } : null, active.id)
  const response = adviceResponse(advice.response, 'robber')
  const suggestion = initial ?? response
  const [picked, setPicked] = useState<{ hex: AxialCoord; id: number } | null>(null)
  const pickSequence = useRef(0)
  const hex = picked?.hex
  const showSuggestion = initial !== undefined || active.id === me
  useEffect(() => {
    if (showSuggestion && suggestion) {
      mark(adviceMarks({ type: 'playKnight', hex: suggestion.hex, victim: suggestion.victim }, active.color))
    }
    return () => mark(null)
  }, [game, active.color, showSuggestion, suggestion, mark])
  const record = (hex: AxialCoord, victimId: string | null, stolen: Resource | null) => {
    const next = knight
      ? recordPlayDev(game, { kind: 'knight', hex, victimId, stolen })
      : recordRobber(game, hex, victimId, stolen)
    const destination = game.board.hexes.find((tile) => axialKey(tile.coord) === axialKey(hex))
    const label = destination?.numberToken ? `the ${destination.numberToken}` : 'the desert'
    const victim = game.board.players.find((player) => player.id === victimId)
    commit(next, `${knight ? 'Played Knight · Robber' : 'Robber'} to ${label}${victim ? `${knight ? ', stole' : ' · Stole'} from ${victim.name}` : ' · Nobody robbed'}`)
    finish()
  }
  const candidates = hex ? robberCandidates(game, hex, active.id) : []
  return (
    <div className="move-robber">
      {adviceEnabled && active.id === me && initial === undefined && <AdviceFeedback advice={advice} />}
      {showSuggestion && suggestion && (
        <p>Suggested: {hexLabel(suggestion.hex, game.board)}, {suggestion.victim === null ? 'rob nobody'
          : `steal from ${game.board.players.find((player) => player.id === suggestion.victim)?.name}`}
          {response?.reason && `. ${response.reason}`}
        </p>
      )}
      <div className="move-question">Where did the robber go?<span>Tap its new number on the board</span></div>
      <RobberPick onPick={(hex) => {
        const id = ++pickSequence.current
        if (robberCandidates(game, hex, active.id).length === 0) record(hex, null, null)
        else setPicked({ hex, id })
      }} />
      {hex && <RobberPopover key={picked?.id} game={game} active={active} hex={hex} candidates={candidates}
        onRecord={(victim, stolen) => record(hex, victim, stolen)} close={() => setPicked(null)} />}
    </div>
  )
}

function RobberPick({ onPick }: { onPick(hex: AxialCoord): void }) {
  useBoardPick({ want: 'hex' }, (ref) => onPick(parseAxialKey(ref)))
  return null
}

function RobberPopover({ game, active, hex, candidates, onRecord, close }: {
  game: Game
  active: Player
  hex: AxialCoord
  candidates: string[]
  onRecord(victim: string | null, stolen: Resource | null): void
  close(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [victim, setVictim] = useState<string | null>(null)
  const mine = active.id === game.board.mePlayerId
  useLayoutEffect(() => {
    const popover = ref.current
    if (!popover) return
    popover.showPopover()
    return () => popover.hidePopover()
  }, [])
  useLayoutEffect(() => {
    const popover = ref.current
    const anchor = document.querySelector(`[data-hex="${axialKey(hex)}"]`)
    if (!popover || !anchor) return
    const position = placeBelow(anchor.getBoundingClientRect(), popover.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
    popover.style.left = `${position.left}px`
    popover.style.top = `${position.top}px`
    popover.querySelector('button')?.focus({ preventScroll: true })
  }, [hex, victim])
  const victimName = game.board.players.find((player) => player.id === victim)?.name
  return (
    <div ref={ref} className="move-robber-pop" popover="auto" role="dialog" aria-label="Robber"
      onToggle={(event) => { if (event.newState === 'closed') close() }}>
      {victim ? (
        <>
          <h3>{mine ? `What did you take from ${victimName}?` : `What did ${active.name} take from you?`}</h3>
          <ResourcePicker onChange={(resource) => onRecord(victim, resource)} />
          <button type="button" onClick={() => setVictim(null)}>Back</button>
        </>
      ) : (
        <>
          <h3>Robber to {hexLabel(hex, game.board)}. {mine ? 'Steal from' : `${active.name} stole from`}</h3>
          <div className="move-robber-list">
            {candidates.map((id) => {
              const player = game.board.players.find((player) => player.id === id)!
              return <button type="button" key={id} onClick={() => {
                if (mine || id === game.board.mePlayerId) setVictim(id)
                else onRecord(id, null)
              }}>
                <span className="swatch" style={{ background: player.color }} />
                {player.name}<small>{handTotal(statsFor(game, id))} cards</small>
              </button>
            })}
            <button type="button" onClick={() => onRecord(null, null)}>Nobody</button>
          </div>
        </>
      )}
    </div>
  )
}

function TradeTray({ game, active, tray, adviceEnabled, commit, close }: TrayProps) {
  const fill = tray.fill?.open === 'trade' ? tray.fill.fill : null
  const [gives, setGives] = useState<Partial<Cards>>(fill ? { [fill.give]: fill.count } : {})
  const [gets, setGets] = useState<Partial<Cards>>(fill ? { [fill.get]: 1 } : {})
  const given = RESOURCES.filter((resource) => gives[resource])
  const received = RESOURCES.filter((resource) => gets[resource])
  const give = given.length === 1 ? given[0] : null
  const get = received.length === 1 ? received[0] : null
  const stats = statsFor(game, active.id)
  const ports = bankPorts(game.board, active.id)
  const genericRate = ports.some((port) => port.resource === null && port.rate === 3) ? 3 : 4
  const valid = given.length > 0 && received.length > 0 && !given.some((resource) => received.includes(resource)) && canCover(stats, gives)
  const decision = give && get && active.id !== game.board.mePlayerId
    ? tradeVerdictRequest(game, active.id, game.board.mePlayerId, { resource: give, count: gives[give]! }, { resource: get, count: gets[get]! })
    : null
  const verdict = useAdvice(adviceEnabled ? decision : null, game.board.mePlayerId)
  const response = adviceResponse(verdict.response, 'tradeResponse')
  const amounts = (cards: Partial<Cards>) => RESOURCES.filter((resource) => cards[resource]).map((resource) => `${cards[resource]} ${resource}`).join(' and ')
  return (
    <div className="move-tray">
      <div className="move-tray-head"><span>{active.name} gives</span>
        {(given.length > 0 || received.length > 0) && <button type="button" className="move-trade-clear" aria-label="Clear" title="Clear" onClick={() => { setGives({}); setGets({}) }}><EraserGlyph /></button>}
      </div>
      <ResourcePicker label="Gives" cards={gives} available={stats.handUnknown === 0 ? stats.hand : undefined}
        disabled={(resource) => !canCover(stats, { ...gives, [resource]: (gives[resource] ?? 0) + 1 })}
        onChange={(resource) => setGives({ ...gives, [resource]: (gives[resource] ?? 0) + 1 })}
        onRemove={(resource) => setGives({ ...gives, [resource]: gives[resource]! - 1 })} />
      <div className="move-tray-head">and gets</div>
      <ResourcePicker label="Gets" cards={gets}
        onChange={(resource) => setGets({ ...gets, [resource]: (gets[resource] ?? 0) + 1 })}
        onRemove={(resource) => setGets({ ...gets, [resource]: gets[resource]! - 1 })} />
      <div className="move-tray-head">with</div>
      <div className="move-partners" role="group" aria-label="Trade partner">
        <button type="button" disabled={!valid || !isValidBankTrade(game.board, active.id, gives, gets)} onClick={() => {
          const ordered = given.toSorted((a, b) => bankRate(game.board, active.id, a) - bankRate(game.board, active.id, b))
          const paid = ordered.map((resource) => `${gives[resource]} ${resource}`).join(' and ')
          const party = given.every((resource) => bankRate(game.board, active.id, resource) === 4) ? 'bank' : 'port'
          commit(recordBankTrade(game, gives, gets), `Traded ${paid} to the ${party} for ${amounts(gets)}`)
          close()
        }}>{ports.length ? 'Port' : 'Bank'} <small>{genericRate}:1{ports.flatMap((port) => port.rate === 2 && port.resource !== null
          ? <span key={port.edgeId}> · 2:1 <span role="img" aria-label={port.resource}><ResourceGlyph resource={port.resource} /></span></span>
          : [])}</small></button>
        {game.board.players.filter((player) => player.id !== active.id).map((player) => {
          const covers = canCover(statsFor(game, player.id), gets)
          return <button type="button" key={player.id} disabled={!valid || !covers}
            title={!covers ? `${player.name} cannot hold those cards` : !valid ? 'Enter different cards in both rows that the active player can give' : undefined}
            onClick={() => {
              commit(recordPlayerTrade(game, player.id, gives, gets), `Traded ${amounts(gives)} to ${player.name} for ${amounts(gets)}`)
              close()
            }}><span className="move-player-dot" style={{ background: player.color }} />{player.name}</button>
        })}
      </div>
      {adviceEnabled && decision && <AdviceFeedback advice={verdict} />}
      {decision && response && (
        <div className="move-verdict">
          {'Advice for you: '}<b>{response.accept ? 'Accept' : 'Decline'}</b>
          {response.margin !== null && ` (${response.margin.toFixed(2).replace('-', '−')})`}
          {response.reason && `: ${response.reason}`}
        </div>
      )}
    </div>
  )
}

function BuildTray({ game, active, commit, close }: TrayProps) {
  const [piece, setPiece] = useState<'road' | 'settlement' | 'city' | null>(null)
  const pieces = useMemo(() => buildablePieces(game, active.id), [game, active.id])
  useBoardPick(piece === null ? null : piece === 'road' ? { want: 'edge' } : { want: 'vertex', piece }, (ref) => {
    if (!piece) return
    commit(recordBuild(game, piece, ref as EdgeId | VertexId), `Built a ${piece}`)
    close()
  })
  const who = active.id === game.board.mePlayerId ? 'you' : active.name
  return (
    <div className="move-tray">
      <div className="move-question">What did {who} build?</div>
      <div className="move-card-choices move-build-choices" role="group" aria-label="Piece">
        {pieces.map((kind) => (
          <button type="button" className={`move-build-${kind}`} key={kind} aria-pressed={piece === kind} onClick={() => setPiece(kind)}>
            <StructureGlyph shape={kind} color={active.color} size={17} />
            <span className="move-piece-text"><span className="move-piece-name">{kind[0].toUpperCase() + kind.slice(1)}</span>
              <span className="move-piece-cost"><CardAmounts cards={CARD_COSTS[kind]} /></span>
            </span>
          </button>
        ))}
      </div>
      {piece && <div className="move-question">Where is the new {piece}?<span>Tap its spot on the board</span></div>}
    </div>
  )
}

function BuyTray({ game, commit, close }: TrayProps) {
  return (
    <div className="move-tray">
      <div className="move-question">Which card did you draw?</div>
      <div className="move-card-choices" role="group" aria-label="Drawn card">
        {[...DEV_KINDS, 'vp' as const].map((kind) => (
          <button type="button" key={kind} onClick={() => { commit(recordBuyDev(game, kind), recordedMoveLabel({ type: 'buyDev' })); close() }}>
            <DevChipGlyph kind={kind} /><span>{kind === 'vp' ? 'Victory point' : DEV_LABELS[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayTray({ game, active, tray, commit, close, knight }: TrayProps) {
  const fill = tray.fill?.open === 'play' ? tray.fill.fill : null
  const [kind, setKind] = useState<DevKind | null>(fill?.type === 'monopoly' ? 'monopoly' : null)
  const typed = typedDevHand(game, active.id)
  const who = active.id === game.board.mePlayerId ? 'you' : active.name
  const record = (play: DevPlay, text: string) => {
    commit(recordPlayDev(game, play), text)
    close()
  }
  return (
    <div className="move-tray">
      <div className="move-question">Which card did {who} play?</div>
      <div className="move-card-choices" role="group" aria-label="Played card">
        {DEV_KINDS.filter((card) => !typed || typed.playable[card] > 0).map((card) => (
          <button type="button" key={card} aria-pressed={kind === card} onClick={() => card === 'knight' ? knight() : setKind(card)}>
            <DevChipGlyph kind={card} /><span>{DEV_LABELS[card]}</span>
          </button>
        ))}
      </div>
      {kind === 'roadBuilding' && <RoadBuildingInputs color={active.color} onRecord={record} />}
      {kind === 'yearOfPlenty' && <PlentyInputs who={who} onRecord={record} />}
      {kind === 'monopoly' && <MonopolyInputs game={game} activeId={active.id} who={who} initial={fill?.type === 'monopoly' ? fill.resource : null} onRecord={record} />}
    </div>
  )
}

function RoadBuildingInputs({ color, onRecord }: { color: string; onRecord(play: DevPlay, text: string): void }) {
  const [edges, setEdges] = useState<readonly [] | readonly [EdgeId]>([])
  const record = (roads: readonly [] | readonly [EdgeId] | readonly [EdgeId, EdgeId]) =>
    onRecord({ kind: 'roadBuilding', edges: roads }, `Played Road building · ${roads.length} ${roads.length === 1 ? 'road' : 'roads'}`)
  useBoardPick({ want: 'edge', edges }, (ref) => {
    const edge = ref as EdgeId
    if (edges.length === 0) setEdges([edge])
    else if (edges[0] !== edge) record([edges[0], edge])
  })
  return (
    <>
      <div className="move-question">Where did the roads go?<span>Tap each spot on the board</span></div>
      <div className="move-road-slots">
        {[0, 1].map((index) => <div key={index} className={`move-road-slot${edges.length > index ? ' placed' : edges.length === index ? ' next' : ''}`}>
          <StructureGlyph shape="road" color={edges.length > index ? color : 'transparent'} size={18} />
          <span>{edges.length > index ? `Road ${index + 1} placed` : edges.length === index ? `Road ${index + 1}: tap a spot` : `Road ${index + 1}`}</span>
          {edges.length > index && index === edges.length - 1 && <button type="button" className="move-minus" aria-label={`Take back road ${index + 1}`} onClick={() => setEdges([])}><MinusGlyph /></button>}
        </div>)}
      </div>
      <div className="move-tray-footer"><button type="button" className="move-record" onClick={() => record(edges)}><CheckGlyph />Record {edges.length} {edges.length === 1 ? 'road' : 'roads'}</button></div>
    </>
  )
}

function PlentyInputs({ who, onRecord }: { who: string; onRecord(play: DevPlay, text: string): void }) {
  const [first, setFirst] = useState<Resource | null>(null)
  return (
    <>
      <div className="move-question">Which two cards did {who} take?</div>
      <ResourcePicker label="Takes" cards={first ? { [first]: 1 } : {}} onRemove={() => setFirst(null)} onChange={(resource) => {
        if (first) onRecord({ kind: 'yearOfPlenty', resources: [first, resource] }, recordedMoveLabel({ type: 'yearOfPlenty', first, second: resource }))
        else setFirst(resource)
      }} />
    </>
  )
}

function MonopolyInputs({ game, activeId, who, initial, onRecord }: {
  game: Game
  activeId: string
  who: string
  initial: Resource | null
  onRecord(play: DevPlay, text: string): void
}) {
  const others = game.board.players.filter((player) => player.id !== activeId)
  const counts = (resource: Resource | null) => Object.fromEntries(others.map(({ id }) => [id, resource ? statsFor(game, id).hand[resource] : 0]))
  const [resource, setResource] = useState<Resource | null>(initial)
  const [taken, setTaken] = useState<Record<string, number>>(() => counts(initial))
  const total = Object.values(taken).reduce((sum, count) => sum + count, 0)
  return (
    <>
      <div className="move-question">Which resource did {who} name?</div>
      <ResourcePicker label="Named resource" value={resource} onChange={(resource) => { setResource(resource); setTaken(counts(resource)) }} />
      {resource && <>
        <div className="move-question">How many did each player give?</div>
        <div className="move-monopoly-players">
          {others.map((player) => {
            const count = taken[player.id] ?? 0
            const { lo, hi } = cardRange(statsFor(game, player.id), resource, false)
            return <div key={player.id} className={`move-monopoly-player${count > 0 ? ' has-cards' : ''}`}>
              <span className="move-monopoly-name"><span className="move-player-dot" style={{ background: player.color }} /><span>{player.name}</span></span>
              <button type="button" className="move-monopoly-count" aria-label={`One more from ${player.name}`} disabled={count >= hi}
                onClick={() => setTaken({ ...taken, [player.id]: count + 1 })}>{count}</button>
              <small>of {lo === hi ? lo : `${lo}\u2013${hi}`}</small>
              {count > 0 && <button type="button" className="move-minus" aria-label={`One fewer from ${player.name}`} onClick={() => setTaken({ ...taken, [player.id]: count - 1 })}><MinusGlyph /></button>}
            </div>
          })}
        </div>
        <div className="move-tray-footer"><span>Takes {total} {resource}</span>
          <button type="button" className="move-record" onClick={() => onRecord({ kind: 'monopoly', resource, taken },
            `Played Monopoly on ${resource} · Took ${total}`)}><CheckGlyph />Record</button>
        </div>
      </>}
    </>
  )
}
