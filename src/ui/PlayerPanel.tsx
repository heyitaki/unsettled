import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { analyzeBoardCached } from '../engine/analyze'
import { computeStandings, type PlayerStanding } from '../engine/stats'
import {
  addPlayer,
  movePlayer,
  removePlayer,
  renamePlayer,
} from '../model/board'
import { adjustCounter, adjustHand, type Game, type PlayerStats, type StatCounter } from '../model/game'
import { PLAYER_PALETTE, RESOURCES, type Board, type Resource } from '../model/types'
import { readableInk } from './colors'
import { draftSlots } from './draftSlots'
import { CounterGlyph, GLYPH_MUTED, ResourceGlyph, StructureGlyph } from './glyphs'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore } from './store'
import { useCoarsePointer } from './useMediaQuery'
import { useRowReorder } from './useRowReorder'

const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

const TALLY_PX = 13

interface TallyColumn {
  key: string
  label: string
  icon: ReactNode
  value: (standing: PlayerStanding, stats: PlayerStats) => number
  /** Longer per-row tooltip where the bare count leaves something out. */
  detail?: (standing: PlayerStanding) => string
  /** Marks the count that won a card — the award holder's roads/knights. */
  emphasize?: (standing: PlayerStanding) => boolean
}

type TallyView = 'pieces' | 'resources'

const VIEW_OPTIONS: readonly { value: TallyView; label: string }[] = [
  { value: 'pieces', label: 'Pieces' },
  { value: 'resources', label: 'Resources' },
]

// Header and rows iterate this one list, so a column cannot drift out of
// alignment with its heading.
const TALLY_COLUMNS: TallyColumn[] = [
  {
    key: 'settlements',
    label: 'Settlements',
    icon: <StructureGlyph shape="settlement" color={GLYPH_MUTED} size={TALLY_PX} />,
    value: (standing) => standing.settlements,
  },
  {
    key: 'cities',
    label: 'Cities',
    icon: <StructureGlyph shape="city" color={GLYPH_MUTED} size={TALLY_PX} />,
    value: (standing) => standing.cities,
  },
  {
    key: 'superCities',
    label: 'Super cities',
    icon: <StructureGlyph shape="superCity" color={GLYPH_MUTED} size={TALLY_PX} />,
    value: (standing) => standing.superCities,
  },
  {
    // The award is about the longest single run, so that is the number worth a
    // column; the total is a footnote in the tooltip.
    key: 'roads',
    label: 'Longest road',
    icon: <StructureGlyph shape="road" color={GLYPH_MUTED} size={TALLY_PX} />,
    value: (standing) => standing.longestRoad,
    // Carries the "+2 VP" the removed award badge used to spell out.
    detail: (standing) => standing.hasLongestRoad
      ? `${standing.roads} roads placed · holds the card, +2 VP`
      : `${standing.roads} roads placed`,
    emphasize: (standing) => standing.hasLongestRoad,
  },
  {
    key: 'devCards',
    label: 'Development cards held',
    icon: <CounterGlyph shape="devCard" />,
    value: (_standing, stats) => stats.devCards,
  },
  {
    key: 'knights',
    label: 'Knights played',
    icon: <CounterGlyph shape="knight" />,
    value: (_standing, stats) => stats.knights,
    emphasize: (standing) => standing.hasLargestArmy,
  },
]

/** The other view: what everyone is holding right now. */
const RESOURCE_COLUMNS: TallyColumn[] = [
  ...RESOURCES.map((resource) => ({
    key: resource,
    label: RESOURCE_LABELS[resource],
    icon: <ResourceGlyph resource={resource} />,
    value: (_standing: PlayerStanding, stats: PlayerStats) => stats.hand[resource],
  })),
  {
    key: 'handUnknown',
    label: 'Unknown',
    icon: <CounterGlyph shape="unknownCard" />,
    value: (_standing, stats) => stats.handUnknown,
  },
]

const vpBreakdown = (standing: PlayerStanding, vpCards: number): string => [
  `${standing.settlements} × settlement`,
  `${standing.cities} × city (2)`,
  ...(standing.superCities > 0 ? [`${standing.superCities} × super city (3)`] : []),
  ...(standing.hasLongestRoad ? ['longest road (+2)'] : []),
  ...(standing.hasLargestArmy ? ['largest army (+2)'] : []),
  ...(vpCards > 0 ? [`${vpCards} × VP card`] : []),
].join(' · ')

/** One −/count/+ stepper for a hand resource or a counter stat. */
function StatChip({ label, icon, count, adjust }: {
  label: string
  icon: ReactNode
  count: number
  adjust: (delta: number) => void
}) {
  return (
    <span className="stat-chip" title={label}>
      <button type="button" aria-label={`Remove ${label}`} disabled={count === 0} onClick={() => adjust(-1)}>−</button>
      <span className="stat-face" aria-label={`${label}: ${count}`}>
        {icon}
        {count}
      </span>
      <button type="button" aria-label={`Add ${label}`} onClick={() => adjust(1)}>+</button>
    </span>
  )
}


export function PlayerPanel() {
  const { state, dispatch } = useStore()
  const coarse = useCoarsePointer()
  const tab = activeTab(state)
  const { game } = tab
  const { board } = game
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const commitGame = (nextGame: Game) => dispatch({ type: 'commit-game', game: nextGame })
  const standings = computeStandings(game)
  // The super-city tally only appears once one is on the board — the base game
  // never has them, so the column would be noise.
  const showSuperCities = standings.some((standing) => standing.superCities > 0)
  const [view, setView] = useState<TallyView>('pieces')
  const [caption, setCaption] = useState<{ key: string; text: string } | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  useEffect(() => {
    setSelectedSlot(null)
  }, [board])
  const columns = view === 'resources'
    ? RESOURCE_COLUMNS
    : TALLY_COLUMNS.filter((column) => column.key !== 'superCities' || showSuperCities)

  const analysis = analyzeBoardCached(board)
  const slots = draftSlots(board, analysis)
  const clearHighlight = () => dispatch({ type: 'highlight', marks: null })

  // Dragged from anywhere on the card; only a row being renamed is undraggable,
  // so the input keeps its text selection. Dropping on the trash row (which only
  // exists mid-drag) removes the player.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { listRef, dragId, dropTarget, rowProps, trashProps } = useRowReorder({
    coarse,
    ids: board.players.map((player) => player.id),
    rowSelector: '.player-card',
    trashSelector: '.player-trash',
    lockedId: renamingId,
    onMove: (playerId, index) => commit(movePlayer(board, playerId, index)),
    onRemove: (playerId) => commit(removePlayer(board, playerId)),
  })

  return (
    <section className="panel player-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Points ledger</span>
          <h2>Players</h2>
        </div>
        <button
          type="button"
          className="player-add"
          aria-label="Add player"
          disabled={board.players.length >= 6}
          onClick={() => {
            const index = board.players.length
            const colors = Object.values(PLAYER_PALETTE)
            const nextBoard = addPlayer(board, { name: `Player ${index + 1}`, color: colors[index % colors.length] })
            commit(nextBoard)
            dispatch({ type: 'active-player', playerId: nextBoard.players.at(-1)?.id ?? tab.activePlayerId })
          }}
        >+</button>
      </div>
      <div className="player-list" ref={listRef}>
        {/* Column headings, with the view switch on their left. Each player's
            numbers carry their own aria-label, so the icon strip is decorative
            for assistive tech. The label rides in data-label: a CSS tooltip
            beats the native one's delay, and it matches the history buttons. */}
        <div className="tally-bar">
          <MenuSelect
            ariaLabel="Player table view"
            value={view}
            options={VIEW_OPTIONS}
            onSelect={setView}
          >
            <strong>{VIEW_OPTIONS.find((option) => option.value === view)?.label}</strong>
          </MenuSelect>
          <div className="tally-header" aria-hidden={coarse ? undefined : true}>
            {columns.map((column) => (
              coarse ? (
                <button
                  type="button"
                  key={column.key}
                  className={caption?.key === column.key ? 'active' : undefined}
                  aria-label={column.label}
                  onClick={() => setCaption((current) =>
                    current?.key === column.key ? null : { key: column.key, text: column.label })}
                >
                  {column.icon}
                </button>
              ) : <span key={column.key} data-label={column.label}>{column.icon}</span>
            ))}
            {coarse ? (
              <button
                type="button"
                className={`vp-head ${caption?.key === 'vp' ? 'active' : ''}`}
                aria-label="Victory points"
                onClick={() => setCaption((current) =>
                  current?.key === 'vp' ? null : { key: 'vp', text: 'Victory points' })}
              >
                VP
              </button>
            ) : <span className="vp-head" data-label="Victory points">VP</span>}
          </div>
        </div>
        {coarse && caption && (
          <p className="tally-caption">{caption.text}</p>
        )}
        {board.players.map((player, index) => {
          const standing = standings[index]
          const stats = game.stats[player.id]
          const active = tab.activePlayerId === player.id
          const isMe = board.mePlayerId === player.id
          return (
            <div
              className={[
                'player-card',
                active ? 'active' : '',
                dragId === player.id ? 'dragging' : '',
                dragId !== null && dropTarget?.kind === 'row' && dropTarget.index === index ? 'drag-over' : '',
              ].join(' ')}
              key={player.id}
              {...rowProps(player.id)}
              onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
            >
              <div className="player-row">
                <span className="drag-handle" title="Hold to reorder, or drag onto the trash to remove" aria-hidden="true">⠿</span>
                <button
                  className="player-dot"
                  type="button"
                  title={active ? 'Deselect this player' : 'Use this player for new pieces'}
                  aria-pressed={active}
                  style={{ background: player.color }}
                  onClick={(event) => {
                    // Toggles like the tool palette: clicking the selected
                    // player's dot deselects, so board clicks place nothing.
                    // stopPropagation or the card's own handler re-selects.
                    event.stopPropagation()
                    dispatch({ type: 'active-player', playerId: active ? null : player.id })
                  }}
                />
                {/* The name is plain text until clicked: a permanent input ate
                    the row's width, which the tally columns now need. */}
                {renamingId === player.id ? (
                  <input
                    className="player-name-input"
                    autoFocus
                    aria-label={`Name for player ${index + 1}`}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    value={player.name}
                    onChange={(event) => commit(renamePlayer(board, player.id, event.target.value))}
                    onBlur={() => setRenamingId(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="player-name"
                    title={`${player.name} — click to rename`}
                    onClick={() => setRenamingId(player.id)}
                  >{player.name}</button>
                )}
                {/* Awards sit beside the name, not in the tally columns: they
                    are worth +2 VP each and would otherwise break the table's
                    alignment on the rows that hold them. */}
                {/* No badge for longest road: the bolded run in its column says
                    who holds it, and the pill's road glyph read as a slash. */}
                <span className="player-awards">
                  {standing.hasLargestArmy && (
                    <span
                      className="award"
                      title={`Largest army (${stats.knights}) · +2 VP`}
                      aria-label={`Largest army: ${stats.knights} knights, +2 victory points`}
                    >
                      <CounterGlyph shape="knight" color="#fff" />
                    </span>
                  )}
                </span>
                <div className="player-tally">
                  {columns.map((column) => {
                    const count = column.value(standing, stats)
                    const detail = column.detail?.(standing)
                    return (
                      <span
                        key={column.key}
                        className={[
                          count === 0 ? 'zero' : '',
                          column.emphasize?.(standing) ? 'strong' : '',
                        ].join(' ').trim()}
                        title={detail ? `${column.label}: ${count} (${detail})` : `${column.label}: ${count}`}
                        aria-label={`${column.label}: ${count}`}
                      >
                        {count}
                      </span>
                    )
                  })}
                  {coarse ? (
                    <button
                      type="button"
                      className="player-vp"
                      aria-label={`Victory points: ${standing.victoryPoints}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        const text = vpBreakdown(standing, stats.vpCards)
                        setCaption((current) =>
                          current?.key === `vp:${player.id}` ? null : { key: `vp:${player.id}`, text })
                      }}
                    >
                      {standing.victoryPoints}
                    </button>
                  ) : (
                    <span
                      className="player-vp"
                      title={`Victory points: ${vpBreakdown(standing, stats.vpCards)}`}
                      aria-label={`Victory points: ${standing.victoryPoints}`}
                    >
                      {standing.victoryPoints}
                    </span>
                  )}
                </div>
              </div>
              {active && (
                <div className="player-steppers">
                  {RESOURCES.map((resource) => (
                    <StatChip
                      key={resource}
                      label={RESOURCE_LABELS[resource]}
                      icon={<ResourceGlyph resource={resource} />}
                      count={stats.hand[resource]}
                      adjust={(delta) => commitGame(adjustHand(game, player.id, resource, delta))}
                    />
                  ))}
                  <StatChip
                    label="Unknown"
                    icon={<CounterGlyph shape="unknownCard" />}
                    count={stats.handUnknown}
                    adjust={(delta) => commitGame(adjustCounter(game, player.id, 'handUnknown', delta))}
                  />
                  {(['devCards', 'knights'] as StatCounter[]).map((counter) => (
                    <StatChip
                      key={counter}
                      label={counter === 'devCards' ? 'Development cards' : 'Knights played'}
                      icon={<CounterGlyph shape={counter === 'devCards' ? 'devCard' : 'knight'} />}
                      count={stats[counter]}
                      adjust={(delta) => commitGame(adjustCounter(game, player.id, counter, delta))}
                    />
                  ))}
                  {isMe && (
                    <StatChip
                      label="VP card"
                      icon={<CounterGlyph shape="vpCard" />}
                      count={stats.vpCards}
                      adjust={(delta) => commitGame(adjustCounter(game, player.id, 'vpCards', delta))}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
        {/* Only exists mid-drag: removing a player is rare enough that it does
            not deserve permanent UI, and the drag is already in the hand. */}
        {dragId !== null && board.players.length > 1 && (
          <div
            className={`player-trash ${dropTarget?.kind === 'trash' ? 'over' : ''}`}
            {...trashProps}
          >
            <StructureGlyph shape="erase" color="currentColor" size={15} />
            Drop here to remove
          </div>
        )}
      </div>
      <div
        className="draft-strip"
        aria-label="Snake draft order"
        // One column per player, so the two snake rounds read as two rows.
        style={{ '--draft-cols': board.players.length } as CSSProperties}
        onMouseLeave={coarse ? undefined : clearHighlight}
      >
        {slots.map(({ playerId, placed, vertex }, slot) => {
          const player = board.players.find((candidate) => candidate.id === playerId)
          if (!player) return null
          const pending = !placed
          return (
            <button
              type="button"
              key={`${playerId}:${slot}`}
              className={`draft-slot ${pending ? 'pending' : ''} ${selectedSlot === slot ? 'selected' : ''}`}
              title={`Pick ${slot + 1}: ${player.name}${
                pending ? (vertex ? ' — predicted spot' : ' — not placed yet') : ''
              }`}
              onMouseEnter={() => {
                if (coarse) return
                if (vertex) {
                  dispatch({
                    type: 'highlight',
                    marks: [{ ref: vertex, color: player.color, label: String(slot + 1) }],
                  })
                } else clearHighlight()
              }}
              onClick={() => {
                if (!coarse) return
                const next = selectedSlot === slot ? null : slot
                setSelectedSlot(next)
                if (next !== null && vertex) {
                  dispatch({
                    type: 'highlight',
                    marks: [{ ref: vertex, color: player.color, label: String(slot + 1) }],
                  })
                } else clearHighlight()
              }}
            >
              <span
                className="slot-circle"
                style={{ background: player.color, color: readableInk(player.color) }}
              >
                {slot + 1}
              </span>
              <span className="slot-name">{player.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
