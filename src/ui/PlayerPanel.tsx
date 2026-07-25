import { useState, type DragEvent, type ReactNode } from 'react'
import { analyzeBoardCached } from '../engine/analyze'
import { draftIsComplete } from '../engine/draft'
import { computeStandings, type PlayerStanding } from '../engine/stats'
import {
  addPlayer,
  movePlayer,
  removePlayer,
  renamePlayer,
} from '../model/board'
import { adjustCounter, adjustHand, type Game, type PlayerStats, type StatCounter } from '../model/game'
import { PLAYER_PALETTE, RESOURCES, type Board, type Resource, type VertexId } from '../model/types'
import { readableInk } from './colors'
import { CounterGlyph, GLYPH_MUTED, ResourceGlyph, StructureGlyph } from './glyphs'
import { activeTab, useStore } from './store'

const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

// The tally reads as a table: icons hoisted into one header row, every player
// row just numbers under them. Header and rows iterate this one list, so a
// column can never drift out of alignment with its heading. Heading glyphs are
// uniform-height and bottom-aligned (see .tally-header), so the strip scans as
// one row of labels rather than a skyline.
const TALLY_PX = 15

interface TallyColumn {
  key: string
  label: string
  icon: ReactNode
  value: (standing: PlayerStanding, stats: PlayerStats) => number
  /** Longer per-row tooltip where the bare count leaves something out. */
  detail?: (standing: PlayerStanding) => string
}

const TALLY_COLUMNS: TallyColumn[] = [
  {
    key: 'settlements',
    label: 'Settlements',
    icon: <StructureGlyph shape="settlement" color={GLYPH_MUTED} size={TALLY_PX} uniform />,
    value: (standing) => standing.settlements,
  },
  {
    key: 'cities',
    label: 'Cities',
    icon: <StructureGlyph shape="city" color={GLYPH_MUTED} size={TALLY_PX} uniform />,
    value: (standing) => standing.cities,
  },
  {
    key: 'superCities',
    label: 'Super cities',
    icon: <StructureGlyph shape="superCity" color={GLYPH_MUTED} size={TALLY_PX} uniform />,
    value: (standing) => standing.superCities,
  },
  {
    key: 'roads',
    label: 'Roads',
    icon: <StructureGlyph shape="road" color={GLYPH_MUTED} size={TALLY_PX} uniform />,
    value: (standing) => standing.roads,
    detail: (standing) => `longest run ${standing.longestRoad}`,
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
  const tab = activeTab(state)
  const { game } = tab
  const { board } = game
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const commitGame = (nextGame: Game) => dispatch({ type: 'commit-game', game: nextGame })
  const standings = computeStandings(game)
  // The super-city tally only appears once one is on the board — the base game
  // never has them, so the column would be noise.
  const showSuperCities = standings.some((standing) => standing.superCities > 0)
  const columns = TALLY_COLUMNS.filter((column) => column.key !== 'superCities' || showSuperCities)

  const analysis = analyzeBoardCached(board)
  const draft = analysis.draft
  const complete = draftIsComplete(board, draft)
  // Slot → placed-settlement mapping: the player's k-th building in board order.
  // Once the draft is complete count any tier, since starting settlements may
  // have been upgraded (placeBuilding upgrades in place, so the index holds).
  // Best-effort only — board order is insertion order for hand-placed boards,
  // but an imported board carries the parser's top-to-bottom spatial order, and
  // deleting then re-placing a building moves it to the end.
  const placedByPlayer = new Map<string, VertexId[]>()
  for (const building of board.buildings) {
    if (!complete && building.tier !== 'settlement') continue
    const list = placedByPlayer.get(building.playerId)
    if (list) list.push(building.vertexId)
    else placedByPlayer.set(building.playerId, [building.vertexId])
  }
  const seenSlots = new Map<string, number>()
  const slotVertex = draft.sequence.map((playerId) => {
    const nth = seenSlots.get(playerId) ?? 0
    seenSlots.set(playerId, nth + 1)
    return placedByPlayer.get(playerId)?.[nth]
  })
  // Predicted spots for unplaced slots: opponents before my next pick come from
  // the modal rollout; my own picks from the top recommendation. Opponent picks
  // past my first pick have no prediction — hovering those shows nothing.
  const predicted = new Map<number, VertexId>()
  const firstMine = draft.myRemainingPickIndices[0]
  if (board.mePlayerId !== null && firstMine !== undefined) {
    const preSlots = draft.remainingPickIndices.filter((slot) =>
      slot >= (draft.turnIndex ?? firstMine) && slot < firstMine && draft.sequence[slot] !== board.mePlayerId)
    analysis.takenBeforeFirstPick.forEach((taken, index) => {
      const slot = preSlots[index]
      if (slot !== undefined) predicted.set(slot, taken.vertexId)
    })
    const top = analysis.recommendations[0]
    if (top) {
      predicted.set(firstMine, top.firstPick)
      const secondMine = draft.myRemainingPickIndices[1]
      if (secondMine !== undefined && top.plannedSecond[0] !== undefined) {
        predicted.set(secondMine, top.plannedSecond[0])
      }
    }
  }
  const clearHighlight = () => dispatch({ type: 'highlight', marks: null })

  // Native HTML5 row reorder. Cards are draggable only while the pointer is
  // down on the ⠿ handle, so dragging never fights name-input text selection.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragArmed, setDragArmed] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const endDrag = () => {
    setDragId(null)
    setDragArmed(null)
    setOverIndex(null)
  }
  const dropOn = (event: DragEvent, index: number) => {
    event.preventDefault()
    if (dragId !== null) commit(movePlayer(board, dragId, index))
    endDrag()
  }

  return (
    <section className="panel player-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Turn order</span>
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
      <div className="player-list">
        {/* Column headings. Each player's numbers carry their own aria-label,
            so the icon strip is decorative for assistive tech. The label rides
            in data-label: a CSS tooltip beats the native one's delay, and it
            matches the history buttons' idiom. */}
        <div className="tally-header" aria-hidden="true">
          {columns.map((column) => (
            <span key={column.key} data-label={column.label}>{column.icon}</span>
          ))}
          <span className="vp-head" data-label="Victory points">VP</span>
        </div>
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
                dragId !== null && overIndex === index ? 'drag-over' : '',
              ].join(' ')}
              key={player.id}
              draggable={dragArmed === player.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                setDragId(player.id)
              }}
              onDragEnd={endDrag}
              onDragOver={(event) => {
                if (dragId === null) return
                event.preventDefault()
                setOverIndex(index)
              }}
              onDrop={(event) => dropOn(event, index)}
              onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
            >
              <div className="player-row">
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  aria-hidden="true"
                  onMouseDown={() => setDragArmed(player.id)}
                  onMouseUp={() => setDragArmed(null)}
                >⠿</span>
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
                <span className="player-awards">
                  {standing.hasLongestRoad && (
                    <span
                      className="award"
                      title={`Longest road (${standing.longestRoad}) · +2 VP`}
                      aria-label={`Longest road: ${standing.longestRoad}, +2 victory points`}
                    >
                      <StructureGlyph shape="road" color="#fff" size={TALLY_PX} />
                    </span>
                  )}
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
                        className={count === 0 ? 'zero' : ''}
                        title={detail ? `${column.label}: ${count} (${detail})` : `${column.label}: ${count}`}
                        aria-label={`${column.label}: ${count}`}
                      >
                        {count}
                      </span>
                    )
                  })}
                  {/* VP rides in the same grid as the last column, so it lines
                      up under its heading like every other number. */}
                  <span
                    className="player-vp"
                    title={`Victory points: ${vpBreakdown(standing, stats.vpCards)}`}
                    aria-label={`Victory points: ${standing.victoryPoints}`}
                  >
                    {standing.victoryPoints}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-danger"
                  aria-label={`Remove ${player.name}`}
                  disabled={board.players.length === 1}
                  onClick={(event) => {
                    // Or the click bubbles to the card and selects the player
                    // this handler just removed. The reducer re-selects for us.
                    event.stopPropagation()
                    commit(removePlayer(board, player.id))
                  }}
                >×</button>
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
      </div>
      <div className="draft-strip" aria-label="Snake draft order" onMouseLeave={clearHighlight}>
        {draft.sequence.map((playerId, slot) => {
          const player = board.players.find((candidate) => candidate.id === playerId)
          if (!player) return null
          const pending = slotVertex[slot] === undefined
          const vertex = slotVertex[slot] ?? predicted.get(slot)
          return (
            <button
              type="button"
              key={`${playerId}:${slot}`}
              className={`draft-slot ${pending ? 'pending' : ''}`}
              title={`Pick ${slot + 1}: ${player.name}${
                pending ? (vertex ? ' — predicted spot' : ' — not placed yet') : ''
              }`}
              onMouseEnter={() => {
                if (vertex) {
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
