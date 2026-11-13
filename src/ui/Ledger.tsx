import { useId, useState } from 'react'
import { computeStandings } from '../engine/stats'
import { adjustCounter, adjustHand, DEV_KINDS, devHandTotal, type DevKind, type Game, type StatCounter } from '../model/game'
import { adjustDevHand, handTotal } from '../model/turn'
import { RESOURCES, type Resource } from '../model/types'
import { DEV_LABELS, statsFor } from './bestMoves'
import { CounterGlyph, DevCardGlyph, ResourceGlyph, StructureGlyph } from './glyphs'
import { MoveStepper } from './MoveInputs'

export function Ledger({ game, activeId, commit }: { game: Game; activeId: string; commit(game: Game): void }) {
  const id = useId()
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
      <div className="ledger-header" aria-hidden="true">
        <span /><span>Hand</span><span>Cards</span><span>VP</span>
      </div>
      {board.players.map((player, index) => {
        const stats = statsFor(game, player.id)
        const standing = standings[index]
        const mine = player.id === me
        const typedTotal = mine && devHand ? devHandTotal(devHand) : 0
        const untyped = stats.devCards - typedTotal
        const cities = standing.cities + standing.superCities
        const rowId = `${id}-${index}`
        return (
          <div key={player.id} className={`ledger-row${player.id === activeId ? ' active' : ''}${editing === player.id ? ' open' : ''}`}>
            <button type="button" className="ledger-toggle" aria-label={`Correct ${player.name}`}
              aria-describedby={`${rowId}-player ${rowId}-hand ${rowId}-cards ${rowId}-vp`}
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
            </button>
            {mine && (typedTotal > 0 || stats.vpCards > 0) && (
              <div className="ledger-dev">
                {DEV_KINDS.map((kind) => <DevPill key={kind} kind={kind} count={devHand?.playable[kind] ?? 0} />)}
                <DevPill kind="vpCard" count={stats.vpCards} />
                {DEV_KINDS.map((kind) => <DevPill key={kind} kind={kind} count={devHand?.bought[kind] ?? 0} bought />)}
              </div>
            )}
            {editing === player.id && (
              <div className="ledger-edit">
                <div className="ledger-stats">
                  <span><b>{standing.settlements}</b> settlements</span>
                  <span><b>{cities}</b> {cities === 1 ? 'city' : 'cities'}</span>
                  <span className={standing.hasLongestRoad ? 'award' : ''}>Longest road <b>{standing.longestRoad}</b></span>
                  <span className={standing.hasLargestArmy ? 'award' : ''}><b>{stats.knights}</b> {stats.knights === 1 ? 'knight' : 'knights'} played</span>
                  <span><b>{stats.devCards}</b> dev cards</span>
                </div>
                <div className="move-chips">
                  {RESOURCES.map((resource) => (
                    <MoveStepper key={resource} label={resource} value={stats.hand[resource]} onChange={(value) => editHand(resource, value)}>
                      <ResourceGlyph resource={resource} />
                    </MoveStepper>
                  ))}
                  <MoveStepper label="Unseen" value={stats.handUnknown} onChange={(value) => editCounter('handUnknown', value)} />
                  {mine ? DEV_KINDS.map((kind) => (
                    <MoveStepper key={kind} label={DEV_LABELS[kind]} value={devHand?.playable[kind] ?? 0} onChange={(value) => editDev(kind, value)} />
                  )) : (
                    <MoveStepper label="Dev" value={stats.devCards} onChange={(value) => editCounter('devCards', value)} />
                  )}
                  <MoveStepper label="Knights" value={stats.knights} onChange={(value) => editCounter('knights', value)} />
                  <MoveStepper label="VP" value={stats.vpCards} onChange={(value) => editCounter('vpCards', value)} />
                </div>
                <div className="ledger-footer">
                  <span>Each change is one undo step</span>
                  <button type="button" className="ledger-done" onClick={() => setEditing(null)}>Done</button>
                </div>
              </div>
            )}
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
