import { useEffect, useRef, useState } from 'react'
import type { AdviceResponse, Cards, KnightPlay } from '../engine/advice/protocol'
import { parseAxialKey } from '../model/coords'
import { DEV_KINDS, emptyStats, type DevKind, type Game } from '../model/game'
import {
  bankRate, CARD_COSTS, handTotal, recordBankTrade, recordBuild, recordBuyDev, recordDiscard,
  recordPlayDev, recordPlayerTrade, recordRobber, recordRoll, type DevPlay,
} from '../model/turn'
import { RESOURCES, type AxialCoord, type EdgeId, type Player, type Resource, type VertexId } from '../model/types'
import { adviceResponse, useAdvice, useAdviceClient, type AdviceState } from './useAdvice'
import {
  adviceMarks, DEV_LABELS, discardInputCards, hexLabel, sevenDiscards, statsFor, tradeVerdictRequest, type AdviceInput,
} from './bestMoves'
import { CardAmounts, MoveStepper, ResourcePicker } from './BestMovesTable'
import { useStore, type HighlightMark } from './store'
import { useBoardPick } from './useBoardPick'

export type TrayKind = 'roll' | 'trade' | 'build' | 'buy' | 'play'
export interface MoveTray { kind: TrayKind; fill?: AdviceInput }
export type Discards = ReturnType<typeof sevenDiscards>
interface TrayProps {
  game: Game
  active: Player
  tray: MoveTray
  adviceEnabled: boolean
  discards: Discards
  commit(game: Game): void
  close(): void
  rolled(game: Game, summary: string, discards: Discards): void
  mark(marks: HighlightMark[] | null): void
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
    case 'roll': return <RollTray {...props} />
    case 'trade': return <TradeTray {...props} />
    case 'build': return <BuildTray {...props} />
    case 'buy': return <BuyTray {...props} />
    case 'play': return <PlayTray {...props} />
  }
}

function RollTray({ game, active, adviceEnabled, commit, close, rolled, discards, mark }: TrayProps) {
  const client = useAdviceClient()
  const { dispatch } = useStore()
  const [rolling, setRolling] = useState<{ game: Game; total: number } | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
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
      const parts = game.board.players.flatMap((player) => {
        const cards = gains && Object.hasOwn(gains, player.id) ? gains[player.id] : null
        const amounts = cards
          ? RESOURCES.filter((resource) => cards[resource] !== 0)
            .map((resource) => `+${cards[resource]} ${resource}`).join(' ')
          : ''
        return amounts ? [`${player.name} ${amounts}`] : []
      })
      const summary = gains === null
        ? 'Production not added: enter the cards by hand'
        : parts.length ? parts.join(' · ') : 'nobody produces'
      rolled(next, `Rolled ${rolling.total} · ${summary}`, [])
      commit(next)
      if (gains === null) dispatch({ type: 'notice', message: summary })
      close()
    })
    return () => { live = false }
  }, [rolling, game, active.id, adviceEnabled, client, dispatch, commit, close, rolled])
  const seven = game.turn?.rolled === 7
  const outstanding = discards.filter(({ playerId, total, count }) =>
    !skipped.includes(playerId) && handTotal(statsFor(game, playerId)) > total - count)
  const roll = (total: number) => {
    if (total !== 7) {
      setRolling({ game, total })
      return
    }
    const next = recordRoll(game, 7, {})
    rolled(next, 'Rolled 7 · nobody produces', sevenDiscards(game))
    commit(next)
  }
  const recordRobberMove = (hex: AxialCoord, victim: string | null, stolen: Resource | null) => {
    commit(recordRobber(game, hex, victim, stolen))
    close()
  }
  return (
    <div className="move-tray">
      <div className="move-dice" role="group" aria-label="Dice total">
        {Array.from({ length: 11 }, (_, index) => index + 2).map((total) => (
          <button
            type="button"
            key={total}
            className={total === 7 ? 'seven' : ''}
            disabled={game.turn?.rolled != null || rolling?.game === game}
            onClick={() => roll(total)}
          >
            {total}
          </button>
        ))}
      </div>
      {rolling?.game === game && <p role="status">Adding production…</p>}
      {game.turn?.rolled != null && <p>Rolled {game.turn.rolled}. Undo to change the roll.</p>}
      {seven && (
        <>
          <p>A seven. Everyone holding more than 7 cards discards half.</p>
          {outstanding.map((entry) => (
            <DiscardLine
              key={entry.playerId}
              game={game}
              adviceEnabled={adviceEnabled}
              {...entry}
              commit={commit}
              skip={() => setSkipped([...skipped, entry.playerId])}
            />
          ))}
          {game.board.players.every((player) => handTotal(statsFor(game, player.id)) <= 7) && (
            <p>Nobody is over 7 cards.</p>
          )}
          <RobberInputs
            game={game}
            active={active}
            adviceEnabled={adviceEnabled}
            mark={mark}
            onRecord={recordRobberMove}
          />
        </>
      )}
    </div>
  )
}

function DiscardLine({ game, playerId, total, count, adviceEnabled, commit, skip }: {
  game: Game
  adviceEnabled: boolean
  playerId: string
  total: number
  count: number
  commit(game: Game): void
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
  const record = () => commit(recordDiscard(game, playerId, me || manual ? selected ?? {} : count))
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

function RobberInputs({ game, active, adviceEnabled, initial, mark, onRecord, knight = false }: {
  game: Game
  active: Player
  adviceEnabled: boolean
  initial?: KnightPlay
  knight?: boolean
  mark(marks: HighlightMark[] | null): void
  onRecord(hex: AxialCoord, victim: string | null, stolen: Resource | null): void
}) {
  const me = game.board.mePlayerId
  const advice = useAdvice(
    adviceEnabled && active.id === me && initial === undefined ? { kind: 'robber' } : null,
    active.id,
  )
  const response = adviceResponse(advice.response, 'robber')
  const [manual, setManual] = useState(false)
  const [hex, setHex] = useState<AxialCoord | null>(null)
  const [victim, setVictim] = useState<string | null | undefined>(undefined)
  const [stolen, setStolen] = useState<Resource | null>(null)
  const useManual = manual || (initial === undefined
    && (!adviceEnabled || active.id !== me || advice.status === 'error'))
  const destination = useManual ? hex : initial?.hex ?? response?.hex ?? null
  const robbed = useManual ? victim : initial ? initial.victim : response?.victim
  const needsStolen = robbed !== null && robbed !== undefined && (active.id === me || robbed === me)
  useBoardPick(useManual && destination === null ? { want: 'hex' } : null, (ref) => setHex(parseAxialKey(ref)))
  const show = () => {
    if (destination) mark(adviceMarks({ type: 'playKnight', hex: destination, victim: robbed ?? null }, active.color))
  }
  const chooseVictim = (id: string | null) => {
    setVictim(id)
    setStolen(null)
  }
  const record = () => {
    if (destination !== null && robbed !== undefined) onRecord(destination, robbed, needsStolen ? stolen : null)
  }
  return (
    <>
      {adviceEnabled && active.id === me && initial === undefined && <AdviceFeedback advice={advice} />}
      {useManual ? (
        <>
          <p>
            {destination
              ? `Robber to ${hexLabel(destination, game.board)}`
              : `Tap the hex ${active.name} moved the robber to, then who was robbed.`}
          </p>
          {destination && <button type="button" onClick={() => setHex(null)}>Choose another hex</button>}
          <div className="move-pick" role="group" aria-label="Robbed">
            <span>Robbed</span>
            {game.board.players.filter((player) => player.id !== active.id).map((player) => (
              <button
                type="button"
                key={player.id}
                aria-pressed={robbed === player.id}
                onClick={() => chooseVictim(player.id)}
              >
                {player.name}
              </button>
            ))}
            <button type="button" aria-pressed={robbed === null} onClick={() => chooseVictim(null)}>Nobody</button>
          </div>
        </>
      ) : destination && (
        <div className="move-pick">
          <span><b>Robber</b></span>
          to {hexLabel(destination, game.board)}, {robbed === null
            ? 'rob nobody'
            : `steal from ${game.board.players.find((player) => player.id === robbed)?.name ?? ''}`}
          <button type="button" onClick={show}>Show</button>
          <button type="button" onClick={() => setManual(true)}>Enter move</button>
        </div>
      )}
      {response?.reason && !useManual && <p>{response.reason}</p>}
      {needsStolen && <ResourcePicker label="Stole" value={stolen} onChange={setStolen} />}
      <button
        type="button"
        className="primary"
        disabled={destination === null || robbed === undefined || (needsStolen && stolen === null)}
        onClick={record}
      >
        {knight ? 'Record' : 'Record robber'}
      </button>
    </>
  )
}

function TradeTray({ game, active, tray, adviceEnabled, commit, close }: TrayProps) {
  const fill = tray.fill?.open === 'trade' ? tray.fill.fill : null
  const [party, setParty] = useState<{ kind: 'bank' } | { kind: 'player'; id: string } | null>(() =>
    fill ? null : { kind: 'bank' })
  const [give, setGive] = useState<Resource>(fill?.give ?? 'wood')
  const [get, setGet] = useState<Resource>(fill?.get ?? 'brick')
  const [giveCount, setGiveCount] = useState(fill?.count ?? 1)
  const [getCount, setGetCount] = useState(1)
  const rate = bankRate(game.board, active.id, give)
  const decision = tradeVerdictRequest(
    game, active.id, party?.kind === 'player' ? party.id : null,
    { resource: give, count: giveCount }, { resource: get, count: getCount },
  )
  const verdict = useAdvice(adviceEnabled ? decision : null, game.board.mePlayerId)
  const response = adviceResponse(verdict.response, 'tradeResponse')
  const record = () => {
    if (!party) return
    commit(party.kind === 'bank'
      ? recordBankTrade(game, give, rate * getCount, get, getCount)
      : recordPlayerTrade(game, party.id, { [give]: giveCount }, { [get]: getCount }))
    close()
  }
  return (
    <div className="move-tray">
      <div className="move-pick" role="group" aria-label="With">
        <span>With</span>
        <button type="button" aria-pressed={party?.kind === 'bank'} onClick={() => setParty({ kind: 'bank' })}>
          Bank {rate}:1
        </button>
        {game.board.players.filter((player) => player.id !== active.id).map((player) => (
          <button
            type="button"
            key={player.id}
            aria-pressed={party?.kind === 'player' && party.id === player.id}
            onClick={() => setParty({ kind: 'player', id: player.id })}
          >
            {player.name}
          </button>
        ))}
      </div>
      <ResourcePicker label={`${active.name} gives`} value={give} onChange={setGive}>
        {party?.kind === 'bank' ? <span>{rate * getCount}</span> : (
          <select
            aria-label="Give count"
            value={giveCount}
            onChange={(event) => setGiveCount(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((count) => <option key={count}>{count}</option>)}
          </select>
        )}
      </ResourcePicker>
      <ResourcePicker label="and gets" value={get} onChange={setGet}>
        <select
          aria-label="Get count"
          value={getCount}
          onChange={(event) => setGetCount(Number(event.target.value))}
        >
          {[1, 2, 3, 4].map((count) => <option key={count}>{count}</option>)}
        </select>
      </ResourcePicker>
      {adviceEnabled && decision && <AdviceFeedback advice={verdict} />}
      {decision && response && (
        <div className="move-verdict">
          {'Advice for you: '}
          <b>{response.accept ? 'Accept' : 'Decline'}</b>
          {response.margin !== null && ` (${response.margin.toFixed(2).replace('-', '−')})`}
          {response.reason && `: ${response.reason}`}
        </div>
      )}
      <button
        type="button"
        className="primary"
        disabled={party === null || getCount < 1 || (party.kind === 'player' && giveCount < 1) || give === get}
        onClick={record}
      >
        Record trade
      </button>
    </div>
  )
}

function BuildTray({ game, active, commit, close }: TrayProps) {
  const [piece, setPiece] = useState<'road' | 'settlement' | 'city' | null>(null)
  useBoardPick(piece === null ? null : piece === 'road' ? { want: 'edge' } : { want: 'vertex', piece }, (ref) => {
    if (!piece) return
    commit(recordBuild(game, piece, ref as EdgeId | VertexId))
    close()
  })
  const name = active.id === game.board.mePlayerId ? 'your' : `${active.name}'s`
  return (
    <div className="move-tray">
      <div className="move-pick" role="group" aria-label="Piece">
        <span>Piece</span>
        {(['road', 'settlement', 'city'] as const).map((kind) => (
          <button type="button" key={kind} aria-pressed={piece === kind} onClick={() => setPiece(kind)}>
            {kind[0].toUpperCase() + kind.slice(1)}
            {' '}
            <CardAmounts cards={CARD_COSTS[kind]} />
          </button>
        ))}
      </div>
      <p>Then tap the spot on the board. The cost comes off {name} hand, known cards first.</p>
    </div>
  )
}

function BuyTray({ game, active, commit, close }: TrayProps) {
  const [drawn, setDrawn] = useState<DevKind | 'vp' | null>(null)
  const mine = active.id === game.board.mePlayerId
  const record = () => {
    commit(recordBuyDev(game, mine ? drawn : null))
    close()
  }
  return (
    <div className="move-tray">
      <p>{active.name} pays <CardAmounts cards={CARD_COSTS.devCard} />.</p>
      {mine && (
        <div className="move-pick" role="group" aria-label="Drew">
          <span>Drew</span>
          {[...DEV_KINDS, 'vp' as const].map((kind) => (
            <button type="button" key={kind} aria-pressed={drawn === kind} onClick={() => setDrawn(kind)}>
              {kind === 'vp' ? 'VP' : DEV_LABELS[kind]}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="primary" disabled={mine && drawn === null} onClick={record}>Record</button>
    </div>
  )
}

function PlayTray({ game, active, tray, adviceEnabled, commit, close, mark }: TrayProps) {
  const fill = tray.fill?.open === 'play' ? tray.fill.fill : null
  const [kind, setKind] = useState<DevKind | null>(
    fill?.type === 'playKnight' ? 'knight' : fill?.type === 'monopoly' ? 'monopoly' : null,
  )
  const record = (play: DevPlay) => {
    commit(recordPlayDev(game, play))
    close()
  }
  const recordKnight = (hex: AxialCoord, victimId: string | null, stolen: Resource | null) =>
    record({ kind: 'knight', hex, victimId, stolen })
  return (
    <div className="move-tray">
      <div className="move-pick" role="group" aria-label="Card">
        <span>Card</span>
        {DEV_KINDS.map((card) => (
          <button type="button" key={card} aria-pressed={kind === card} onClick={() => setKind(card)}>
            {DEV_LABELS[card]}
          </button>
        ))}
      </div>
      {kind === 'knight' && (
        <>
          <p>Then the robber move, as on a seven. Knights played goes up by one.</p>
          <RobberInputs
            game={game}
            active={active}
            adviceEnabled={adviceEnabled}
            initial={fill?.type === 'playKnight' ? fill : undefined}
            knight
            mark={mark}
            onRecord={recordKnight}
          />
        </>
      )}
      {kind === 'roadBuilding' && <RoadBuildingInputs onRecord={record} />}
      {kind === 'yearOfPlenty' && <PlentyInputs onRecord={record} />}
      {kind === 'monopoly' && (
        <MonopolyInputs
          game={game}
          activeId={active.id}
          initial={fill?.type === 'monopoly' ? fill.resource : null}
          onRecord={record}
        />
      )}
    </div>
  )
}

function RoadBuildingInputs({ onRecord }: { onRecord(play: DevPlay): void }) {
  const [edges, setEdges] = useState<readonly [] | readonly [EdgeId] | readonly [EdgeId, EdgeId]>([])
  useBoardPick(edges.length < 2 ? { want: 'edge', edges } : null, (ref) => {
    const edge = ref as EdgeId
    if (edges.length === 0) setEdges([edge])
    else if (edges.length === 1 && edges[0] !== edge) setEdges([edges[0], edge])
  })
  return (
    <>
      <p>Tap up to two road spots on the board. {edges.length} selected.</p>
      {edges.length > 0 && <button type="button" onClick={() => setEdges([])}>Clear roads</button>}
      <button type="button" className="primary" onClick={() => onRecord({ kind: 'roadBuilding', edges })}>
        Record
      </button>
    </>
  )
}

function PlentyInputs({ onRecord }: { onRecord(play: DevPlay): void }) {
  const [first, setFirst] = useState<Resource | null>(null)
  const [second, setSecond] = useState<Resource | null>(null)
  const record = () => {
    if (first && second) onRecord({ kind: 'yearOfPlenty', resources: [first, second] })
  }
  return (
    <>
      <ResourcePicker label="Takes" value={first} onChange={setFirst} />
      <ResourcePicker label="and" value={second} onChange={setSecond} />
      <button type="button" className="primary" disabled={first === null || second === null} onClick={record}>
        Record
      </button>
    </>
  )
}

function MonopolyInputs({ game, activeId, initial, onRecord }: {
  game: Game
  activeId: string
  initial: Resource | null
  onRecord(play: DevPlay): void
}) {
  const [resource, setResource] = useState<Resource | null>(initial)
  const [taken, setTaken] = useState<Record<string, number>>({})
  const record = () => { if (resource) onRecord({ kind: 'monopoly', resource, taken }) }
  return (
    <>
      <ResourcePicker label="Names" value={resource} onChange={setResource} />
      <div className="move-pick">
        <span>Took</span>
        {game.board.players.filter((player) => player.id !== activeId).map((player) => (
          <label key={player.id}>
            {player.name}
            {' '}
            <select
              aria-label={`Took from ${player.name}`}
              value={Object.hasOwn(taken, player.id) ? taken[player.id] : 0}
              onChange={(event) => setTaken({ ...taken, [player.id]: Number(event.target.value) })}
            >
              {Array.from({ length: 10 }, (_, count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button type="button" className="primary" disabled={resource === null} onClick={record}>Record</button>
    </>
  )
}
