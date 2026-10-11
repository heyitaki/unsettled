import { useState, type ReactNode } from 'react'
import { computeStandings, type PlayerStanding } from '../engine/stats'
import { addPlayer } from '../model/board'
import type { PlayerStats } from '../model/game'
import { PLAYER_PALETTE, RESOURCES, type Board, type Resource } from '../model/types'
import { CounterGlyph, GLYPH_MUTED, PlusGlyph, ResourceGlyph, StructureGlyph } from './glyphs'
import { RosterRow, RosterTrash } from './RosterRow'
import { activeTab, useStore } from './store'
import { useCoarsePointer } from './useMediaQuery'
import { useRoster } from './useRoster'
import { AwardControls } from './AwardControls'

const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

const TALLY_PX = 14

interface TallyColumn {
  key: string
  label: string
  icon: ReactNode
  value: (standing: PlayerStanding, stats: PlayerStats) => number
  /** Longer per-row tooltip where the bare count leaves something out. */
  detail?: (standing: PlayerStanding) => string | undefined
  /** Marks the count that won a card, the award holder's roads/knights. */
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
    detail: (standing) => standing.hasLargestArmy ? 'holds the card, +2 VP' : undefined,
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


export function PlayerPanel() {
  const { state, dispatch } = useStore()
  const coarse = useCoarsePointer()
  const tab = activeTab(state)
  const { game } = tab
  const { board } = game
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const standings = computeStandings(game)
  // The super-city tally only appears once one is on the board, the base game
  // never has them, so the column would be noise.
  const showSuperCities = standings.some((standing) => standing.superCities > 0)
  const [view, setView] = useState<TallyView>('pieces')
  const [caption, setCaption] = useState<{ key: string; text: string } | null>(null)
  const columns = view === 'resources'
    ? RESOURCE_COLUMNS
    : TALLY_COLUMNS.filter((column) => column.key !== 'superCities' || showSuperCities)

  const roster = useRoster(board, commit)
  const { listRef, dragId, listProps } = roster.reorder
  const addSeat = () => {
    const index = board.players.length
    const colors = Object.values(PLAYER_PALETTE)
    const nextBoard = addPlayer(board, { name: `Player ${index + 1}`, color: colors[index % colors.length] })
    commit(nextBoard)
    dispatch({ type: 'active-player', playerId: nextBoard.players.at(-1)?.id ?? tab.activePlayerId })
  }

  return (
    <section className="panel player-panel">
      <div className="panel-heading">
        <h2>Players</h2>
        <button
          type="button"
          className="panel-dots"
          aria-label="Add player"
          data-label="Add"
          disabled={board.players.length >= 6}
          onClick={addSeat}
        >
          <PlusGlyph />
        </button>
      </div>
      <div
        className={dragId !== null ? 'player-list roster reordering' : 'player-list roster'}
        ref={listRef}
        {...listProps}
      >
        {/* Column headings, with the view switch on their left. Each player's
            numbers carry their own aria-label, so the icon strip is decorative
            for assistive tech. The label rides in data-label: a CSS tooltip
            beats the native one's delay, and it matches the history buttons. */}
        <div className="tally-bar">
          <div className="tally-tabs" role="group" aria-label="Player table view">
            {VIEW_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
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
          return (
            <RosterRow
              key={player.id}
              player={player}
              index={index}
              roster={roster}
              swatch={
                <button
                  className="swatch"
                  type="button"
                  title={active ? 'Deselect this player' : 'Use this player for new pieces'}
                  aria-label={`Use ${player.name} for new pieces`}
                  aria-pressed={active}
                  style={{ background: player.color }}
                  onClick={() => {
                    dispatch({ type: 'active-player', playerId: active ? null : player.id })
                  }}
                />
              }
            >
              <div className="player-tally">
                {columns.map((column) => {
                  const count = column.value(standing, stats)
                  const detail = column.detail?.(standing)
                  const label = detail ? `${column.label}: ${count} (${detail})` : `${column.label}: ${count}`
                  return (
                    <span
                      key={column.key}
                      className={[
                        count === 0 ? 'zero' : '',
                        column.emphasize?.(standing) ? 'strong' : '',
                      ].join(' ').trim()}
                      title={label}
                      aria-label={label}
                    >
                      {count}
                    </span>
                  )
                })}
              </div>
              {coarse ? (
                <button
                  type="button"
                  className="roster-vp"
                  aria-label={`Victory points: ${standing.victoryPoints}`}
                  onClick={() => {
                    const text = vpBreakdown(standing, stats.vpCards)
                    setCaption((current) =>
                      current?.key === `vp:${player.id}` ? null : { key: `vp:${player.id}`, text })
                  }}
                >
                  {standing.victoryPoints}
                </button>
              ) : (
                <span
                  className="roster-vp"
                  title={`Victory points: ${vpBreakdown(standing, stats.vpCards)}`}
                  aria-label={`Victory points: ${standing.victoryPoints}`}
                >
                  {standing.victoryPoints}
                </span>
              )}
            </RosterRow>
          )
        })}
        <RosterTrash roster={roster} playerCount={board.players.length} />
      </div>
      <AwardControls />
    </section>
  )
}
