import { Fragment, useState, type MouseEvent, type ReactNode } from 'react'
import { computeStandings } from '../engine/stats'
import { adjustCounter, adjustHand, DEV_KINDS, type DevKind, type Game, type StatCounter } from '../model/game'
import { adjustDevHand, handTotal } from '../model/turn'
import { RESOURCES, type Resource } from '../model/types'
import { cardRange, DEV_LABELS, statsFor } from './bestMoves'
import { ResourceGlyph } from './glyphs'

export function MoveStepper({ label, value, onChange, max = Infinity, children }: {
  label: string
  value: number
  onChange(value: number): void
  max?: number
  children?: ReactNode
}) {
  return (
    <span className="move-chip">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span>{children ?? label} {value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}

export function ResourcePicker({ label, value, onChange, children }: {
  label: string
  value: Resource | null
  onChange(value: Resource): void
  children?: ReactNode
}) {
  return (
    <div className="move-pick" role="group" aria-label={label}>
      <span>{label}</span>
      {children}
      {RESOURCES.map((resource) => (
        <button
          type="button"
          key={resource}
          title={resource}
          aria-label={`${label}: ${resource}`}
          aria-pressed={value === resource}
          onClick={() => onChange(resource)}
        >
          <ResourceGlyph resource={resource} />
        </button>
      ))}
    </div>
  )
}

export function CardAmounts({ cards, signed = false }: { cards: Partial<Record<Resource, number>>; signed?: boolean }) {
  return (
    <>
      {RESOURCES.flatMap((resource) => {
        const count = cards[resource] ?? 0
        const amount = `${count < 0 ? '−' : signed ? '+' : ''}${Math.abs(count)}`
        return count === 0 ? [] : [
          <span
            className="hex-label"
            key={resource}
            role="img"
            aria-label={`${amount} ${resource}`}
            title={`${amount} ${resource}`}
          >
            <ResourceGlyph resource={resource} />
            {amount}
          </span>,
        ]
      })}
    </>
  )
}

export function BestMovesTable({ game, activeId, commit }: { game: Game; activeId: string; commit(game: Game): void }) {
  const [view, setView] = useState<'cards' | 'points'>('cards')
  const [editing, setEditing] = useState<string | null>(null)
  const standings = computeStandings(game)
  const { board } = game
  const me = board.mePlayerId
  const devHand = game.devHand?.playerId === me ? game.devHand : undefined
  const editor = board.players.find((player) => player.id === editing)
  const stats = editor ? statsFor(game, editor.id) : null
  const toggle = (id: string) => setEditing((current) => current === id ? null : id)
  const editHand = (resource: Resource, value: number) => {
    if (editor && stats) commit(adjustHand(game, editor.id, resource, value - stats.hand[resource]))
  }
  const editCounter = (counter: StatCounter, value: number) => {
    if (editor && stats) commit(adjustCounter(game, editor.id, counter, value - stats[counter]))
  }
  const editDev = (kind: DevKind, value: number) =>
    commit(adjustDevHand(game, 'playable', kind, value - (devHand?.playable[kind] ?? 0)))
  return (
    <>
      <div className="move-label">
        <span>Table</span>
        <span className="move-seg" role="group" aria-label="Table view">
          {(['cards', 'points'] as const).map((key) => (
            <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>
              {key === 'cards' ? 'Cards' : 'Points'}
            </button>
          ))}
        </span>
      </div>
      <table className="move-table" aria-label={`${view === 'cards' ? 'Cards' : 'Points'} by player`}>
        <thead>
          <tr>
            <th scope="col" aria-label="Player" />
            {view === 'cards' ? (
              <>
                {RESOURCES.map((resource) => (
                  <th key={resource} scope="col" aria-label={resource}>
                    <ResourceGlyph resource={resource} />
                  </th>
                ))}
                <th scope="col" aria-label="Hand total">Σ</th>
                <th scope="col">Dev</th>
              </>
            ) : ['Sett', 'City', 'Road', 'Kn', 'VPc', 'VP'].map((label) => <th key={label} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {board.players.map((player, index) => {
            const stats = statsFor(game, player.id)
            const standing = standings[index]
            const editRow = (event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              toggle(player.id)
            }
            return (
              <tr key={player.id} className={player.id === activeId ? 'active' : ''} onClick={() => toggle(player.id)}>
                <th scope="row">
                  <button
                    type="button"
                    className="move-who"
                    aria-label={`Correct ${player.name} by hand`}
                    aria-expanded={editing === player.id}
                    onClick={editRow}
                    title={player.name}
                  >
                    <span className="swatch" style={{ background: player.color }} />
                    {player.name}
                  </button>
                </th>
                {view === 'cards' ? (
                  <>
                    {RESOURCES.map((resource) => {
                      const { lo, hi } = cardRange(stats, resource, player.id === me)
                      return <td key={resource}>{lo === hi ? lo : <span className="move-range">{lo}–{hi}</span>}</td>
                    })}
                    <td>{handTotal(stats)}</td>
                    <td>{stats.devCards}</td>
                  </>
                ) : (
                  <>
                    <td>{standing.settlements}</td>
                    <td>{standing.cities + standing.superCities}</td>
                    <td>{standing.longestRoad}{standing.hasLongestRoad ? ' ★' : ''}</td>
                    <td>{stats.knights}{standing.hasLargestArmy ? ' ★' : ''}</td>
                    <td>{stats.vpCards}</td>
                    <td>{standing.victoryPoints}</td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {me !== null && (
        <p className="move-mine">
          <b>Your dev cards</b>
          {DEV_KINDS.map((kind) => {
            const count = devHand?.playable[kind] ?? 0
            const bought = devHand?.bought[kind] ?? 0
            return (
              <Fragment key={kind}>
                <span className={count > 0 ? 'has' : ''}>{DEV_LABELS[kind]} {count}</span>
                {bought > 0 && <span className="new">{DEV_LABELS[kind]} {bought}</span>}
              </Fragment>
            )
          })}
          <span className={statsFor(game, me).vpCards > 0 ? 'has' : ''}>VP {statsFor(game, me).vpCards}</span>
        </p>
      )}
      {editor && stats && (
        <div className="move-edit">
          Correct {editor.name} by hand
          <div className="move-chips">
            {RESOURCES.map((resource) => (
              <MoveStepper
                key={resource}
                label={resource}
                value={stats.hand[resource]}
                onChange={(value) => editHand(resource, value)}
              >
                <ResourceGlyph resource={resource} />
              </MoveStepper>
            ))}
            <MoveStepper
              label="Unseen"
              value={stats.handUnknown}
              onChange={(value) => editCounter('handUnknown', value)}
            />
            {editor.id === me ? DEV_KINDS.map((kind) => (
              <MoveStepper
                key={kind}
                label={DEV_LABELS[kind]}
                value={devHand?.playable[kind] ?? 0}
                onChange={(value) => editDev(kind, value)}
              />
            )) : (
              <MoveStepper label="Dev" value={stats.devCards} onChange={(value) => editCounter('devCards', value)} />
            )}
            <MoveStepper label="Knights" value={stats.knights} onChange={(value) => editCounter('knights', value)} />
            <MoveStepper label="VP" value={stats.vpCards} onChange={(value) => editCounter('vpCards', value)} />
          </div>
        </div>
      )}
    </>
  )
}
