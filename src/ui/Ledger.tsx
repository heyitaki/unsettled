import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { awardCandidates, computeStandings, setAwardHolder } from '../engine/stats'
import { adjustCounter, adjustHand, DEV_KINDS, devHandTotal, type AwardKind, type DevKind, type Game, type StatCounter } from '../model/game'
import { adjustDevHand, handTotal } from '../model/turn'
import { historyGame } from '../model/history'
import { RESOURCES, type Resource } from '../model/types'
import { DEV_LABELS, statsFor } from './bestMoves'
import { CounterGlyph, DevCardGlyph, HistoryGlyph, MinusGlyph, ResourceGlyph, StructureGlyph } from './glyphs'
import { RESOURCE_LABELS } from './vertexParts'

const AWARDS: { kind: AwardKind; label: string; medal: ReactNode }[] = [
  { kind: 'longestRoad', label: 'Longest road', medal: <StructureGlyph shape="road" color="var(--accent)" size={14} /> },
  { kind: 'largestArmy', label: 'Largest army', medal: <CounterGlyph shape="knight" /> },
]

// `previous` is the newest game on the tab's undo stack and `onUndo` pops it,
// so the editor's Undo is the app's own undo step rather than a second history.
export function Ledger({ game: liveGame, activeId, previous, commit, onUndo, historyOpen = false, viewedTurn = null, onToggleHistory }: {
  game: Game
  activeId: string | null
  previous: Game | undefined
  commit(game: Game): void
  onUndo(): void
  historyOpen?: boolean
  viewedTurn?: number | null
  onToggleHistory?(): void
}) {
  const id = useId()
  const [editing, setEditing] = useState<string | null>(null)
  const readOnly = historyOpen && viewedTurn !== null
  const game = useMemo(() => readOnly ? historyGame(liveGame, viewedTurn) : liveGame, [liveGame, readOnly, viewedTurn])
  // Game start is before anyone's turn, so no row is marked.
  const shownPlayer = readOnly ? viewedTurn === 0 ? null : game.turn?.playerId : activeId
  if (readOnly && editing !== null) setEditing(null)
  const standings = computeStandings(game)
  const { board } = game
  // A tied award asks who got there first while its holder is unknown: not recorded, and (in a
  // game that never recorded holders) not settled by road order. A pick settles it and the line
  // goes away; undo brings it back. Past views are read-only, so they show none.
  const ties = readOnly ? [] : AWARDS.flatMap((award) => {
    const candidates = awardCandidates(game, award.kind)
    if (candidates.length < 2) return []
    if (standings.some((standing) => award.kind === 'longestRoad' ? standing.hasLongestRoad : standing.hasLargestArmy)) return []
    return [{ ...award, candidates: candidates.map((playerId) => board.players.find((player) => player.id === playerId)!) }]
  })
  const me = board.mePlayerId
  const devHand = game.devHand?.playerId === me ? game.devHand : undefined
  const toggle = (id: string) => setEditing((current) => current === id ? null : id)
  return (
    <>
      <div className="panel-heading">
        <h2>Ledger{readOnly && <span className="ledger-asof">{viewedTurn === 0 ? 'At game start' : `After turn ${viewedTurn}`}</span>}</h2>
        <div className="panel-actions">
          {liveGame.turn && onToggleHistory && <button type="button" className="history-toggle" aria-pressed={historyOpen} onClick={onToggleHistory}>
            <HistoryGlyph />History
          </button>}
        </div>
      </div>
      {ties.map(({ kind, label, medal, candidates }) => (
        <div key={kind} className="tie-line" role="group" aria-label={`${label} tie`} aria-describedby={`${id}-${kind}`}>
          <span className="tie-message" id={`${id}-${kind}`}>
            <span className="ledger-medal" aria-hidden="true">{medal}</span>
            <span><b>{label} tie</b> · Who got there first?</span>
          </span>
          <span className="tie-picks">
            {candidates.map((player) => (
              <button key={player.id} type="button" className="tie-pick"
                onClick={() => commit(setAwardHolder(game, kind, player.id))}>
                <span className="swatch" style={{ background: player.color }} />{player.name}
              </button>
            ))}
          </span>
        </div>
      ))}
      <div className="ledger-header" aria-hidden="true">
        <span /><span>Hand</span><span>Cards</span><span>VP</span>
      </div>
      {board.players.map((player, index) => {
        const stats = statsFor(game, player.id)
        const standing = standings[index]
        const mine = player.id === me
        const typedTotal = mine && devHand ? devHandTotal(devHand) : 0
        const untyped = stats.devCards - typedTotal
        const rowId = `${id}-${index}`
        const showDev = mine && editing !== player.id && (typedTotal > 0 || stats.vpCards > 0)
        return (
          <div key={player.id} className={`ledger-row${player.id === shownPlayer ? ' active' : ''}${editing === player.id ? ' open' : ''}${readOnly ? ' read-only' : ''}`}>
            <button type="button" className="ledger-toggle" aria-label={`Correct ${player.name}`}
              disabled={readOnly}
              aria-describedby={`${rowId}-player ${rowId}-hand ${rowId}-cards ${rowId}-vp${showDev ? ` ${rowId}-dev` : ''}`}
              aria-expanded={editing === player.id} onClick={() => toggle(player.id)}>
              <span className="ledger-player" id={`${rowId}-player`}>
                <span className="swatch" style={{ background: player.color }} />
                <span className="ledger-name" title={player.name}>{player.name}</span>
                {mine && <span className="you-chip">YOU</span>}
                {standing.hasLongestRoad && (
                  <span className="ledger-medal" role="img" aria-label="Longest road, +2 VP" title="Longest road, +2 VP">
                    <StructureGlyph shape="road" color="var(--accent)" size={14} />
                  </span>
                )}
                {standing.hasLargestArmy && (
                  <span className="ledger-medal" role="img" aria-label="Largest army, +2 VP" title="Largest army, +2 VP">
                    <CounterGlyph shape="knight" />
                  </span>
                )}
              </span>
              <span className="ledger-hand" id={`${rowId}-hand`}>
                {RESOURCES.map((resource) => stats.hand[resource] > 0 && (
                  <span className="ledger-hand-chip" key={resource} role="img" title={`${stats.hand[resource]} ${resource}`} aria-label={`${stats.hand[resource]} ${resource}`}>
                    <ResourceGlyph resource={resource} />{stats.hand[resource]}
                  </span>
                ))}
                {stats.handUnknown > 0 && (
                  <span className="ledger-hand-chip muted" role="img" title={`${stats.handUnknown} unseen card${stats.handUnknown === 1 ? '' : 's'}`} aria-label={`${stats.handUnknown} unseen card${stats.handUnknown === 1 ? '' : 's'}`}>
                    <CounterGlyph shape="unknownCard" />{stats.handUnknown}
                  </span>
                )}
                {untyped > 0 && <>
                  <span className="ledger-divider" aria-hidden="true" />
                  <span className="ledger-hand-chip muted" role="img" title={`${untyped} dev cards`} aria-label={`${untyped} dev cards`}>
                    <CounterGlyph shape="devCard" />{untyped}
                  </span>
                </>}
                {handTotal(stats) === 0 && untyped <= 0 && <span className="ledger-empty">No cards</span>}
              </span>
              <span className="ledger-cards" id={`${rowId}-cards`} aria-label={`${handTotal(stats)} cards`}>{handTotal(stats)}</span>
              <span className="ledger-vp" id={`${rowId}-vp`} aria-label={`${standing.victoryPoints} VP`}>{standing.victoryPoints}</span>
              {showDev && (
                <span className="ledger-dev" id={`${rowId}-dev`}>
                  {DEV_KINDS.map((kind) => <DevPill key={kind} kind={kind} count={devHand?.playable[kind] ?? 0} />)}
                  <DevPill kind="vpCard" count={stats.vpCards} />
                  {DEV_KINDS.map((kind) => <DevPill key={kind} kind={kind} count={devHand?.bought[kind] ?? 0} bought />)}
                </span>
              )}
            </button>
            {editing === player.id && <LedgerEditor
              key={player.id}
              game={game}
              playerId={player.id}
              previous={previous}
              commit={commit}
              onUndo={onUndo}
            />}
          </div>
        )
      })}
    </>
  )
}

function DevPill({ kind, count, bought = false }: { kind: DevKind | 'vpCard'; count: number; bought?: boolean }) {
  if (count === 0) return null
  return (
    <span className={`ledger-dev-pill${bought ? ' new' : ''}`} title={bought ? 'Bought this turn, playable next turn' : undefined}>
      {kind === 'vpCard' ? <CounterGlyph shape="vpCard" /> : <DevCardGlyph kind={kind} />}
      <span>
        {kind === 'vpCard' ? 'Victory point' : DEV_LABELS[kind]}
        {count > 1 && <b className="ledger-dev-count">{' '}{count}</b>}
        {bought && <b className="ledger-dev-new">{' '}new</b>}
      </span>
    </span>
  )
}

type Field = Resource | DevKind | StatCounter
interface Tile { field: Field; label: string; change: string; count: number; glyph: ReactNode; bought?: number; award?: boolean }
type TabId = 'hand' | 'dev' | 'points'

function LedgerEditor({ game, playerId, previous, commit, onUndo }: {
  game: Game
  playerId: string
  previous: Game | undefined
  commit(game: Game): void
  onUndo(): void
}) {
  const [tab, setTab] = useState<TabId>('hand')
  const [last, setLast] = useState<{ text: string; before: Game } | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  // Once the change is no longer the newest undo step it is gone for good: the same
  // game can return to the top of the stack later, under someone else's change.
  if (last && previous !== last.before) setLast(null)
  const stats = statsFor(game, playerId)
  const standing = computeStandings(game).find((entry) => entry.playerId === playerId)!
  const mine = playerId === game.board.mePlayerId
  const devHand = mine && game.devHand?.playerId === playerId ? game.devHand : undefined
  const cities = standing.cities + standing.superCities
  const untyped = stats.devCards - (devHand ? devHandTotal(devHand) : 0)
  const unknownDev: Tile = { field: 'devCards', label: 'Unknown', change: 'unknown dev card', count: untyped, glyph: <CounterGlyph shape="devCard" /> }
  const tiles: Record<TabId, Tile[]> = {
    hand: [
      ...RESOURCES.map((resource): Tile => ({ field: resource, label: RESOURCE_LABELS[resource], change: RESOURCE_LABELS[resource], count: stats.hand[resource], glyph: <ResourceGlyph resource={resource} /> })),
      { field: 'handUnknown', label: 'Unseen', change: 'unseen card', count: stats.handUnknown, glyph: <CounterGlyph shape="unknownCard" /> },
    ],
    // The claimed player's dev cards are known by type, plus any whose type was never entered;
    // a rival's are only a count.
    dev: mine
      ? [
          ...DEV_KINDS.map((kind): Tile => ({ field: kind, label: DEV_LABELS[kind], change: DEV_LABELS[kind], count: devHand?.playable[kind] ?? 0, glyph: <DevCardGlyph kind={kind} />, bought: devHand?.bought[kind] ?? 0 })),
          ...untyped > 0 ? [unknownDev] : [],
        ]
      : [unknownDev],
    points: [
      { field: 'knights', label: 'Knights played', change: 'knight played', count: stats.knights, glyph: <CounterGlyph shape="knight" />, award: standing.hasLargestArmy },
      { field: 'vpCards', label: 'Victory points', change: 'victory point', count: stats.vpCards, glyph: <CounterGlyph shape="vpCard" /> },
    ],
  }
  const tabs: { id: TabId; label: string; count: number | null }[] = [
    { id: 'hand', label: 'Hand', count: handTotal(stats) },
    { id: 'dev', label: 'Dev cards', count: stats.devCards },
    { id: 'points', label: 'Points', count: null },
  ]
  const apply = (tile: Tile, delta: number) => {
    const { field } = tile
    const next = (RESOURCES as readonly string[]).includes(field) ? adjustHand(game, playerId, field as Resource, delta)
      : (DEV_KINDS as readonly string[]).includes(field) ? adjustDevHand(game, 'playable', field as DevKind, delta)
        : adjustCounter(game, playerId, field as StatCounter, delta)
    if (next === game) return
    setLast({ text: `${delta > 0 ? 'Added' : 'Took back'} one ${tile.change}`, before: game })
    commit(next)
  }
  return (
    <div className="ledger-edit">
      <div className="ledger-tabs" role="group" aria-label="What to correct" ref={tabsRef}>
        {tabs.map(({ id, label, count }) => (
          <button key={id} type="button" className="ledger-tab" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}{count !== null && <> <span>{count}</span></>}
          </button>
        ))}
      </div>
      <div className="ledger-tiles" style={{ gridTemplateColumns: `repeat(${Math.max(4, tiles[tab].length)}, minmax(0, 1fr))` }}>
        {tiles[tab].map((tile) => (
          <div key={tile.field} className={`ledger-tile${tile.count === 0 && !tile.bought ? ' zero' : ''}`}>
            <button type="button" className="ledger-add" title={tile.label} aria-label={`Add one ${tile.change}, now ${tile.count}`} onClick={() => apply(tile, 1)}>
              {tile.glyph}
              <span className={`ledger-tile-count${tile.award ? ' award' : ''}`}>{tile.count}</span>
              <span className="ledger-tile-label">{tile.label}</span>
              {!!tile.bought && <span className="ledger-tile-new">{tile.bought} new</span>}
            </button>
            {tile.count > 0 && (
              <button type="button" className="move-minus" aria-label={`Take one ${tile.change} back`} onClick={(event) => {
                // The badge unmounts at zero, so hand focus to its tile first.
                if (tile.count === 1) (event.currentTarget.previousElementSibling as HTMLElement).focus()
                apply(tile, -1)
              }}><MinusGlyph /></button>
            )}
          </div>
        ))}
      </div>
      <div className="ledger-status" aria-live="polite">
        {last && (
          <span>{last.text} · <button type="button" className="ledger-undo" onClick={() => {
            // The line unmounts with the undo, so keep focus in the editor.
            tabsRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
            onUndo()
          }}>Undo</button></span>
        )}
        <span>
          <b>{standing.settlements}</b> {standing.settlements === 1 ? 'settlement' : 'settlements'} · <b>{cities}</b> {cities === 1 ? 'city' : 'cities'}
          {' · '}<span className={standing.hasLongestRoad ? 'award' : undefined}>Longest road <b>{standing.longestRoad}</b></span>
        </span>
      </div>
    </div>
  )
}
