import { awardCandidates, computeStandings, setAwardHolder } from '../engine/stats'
import type { AwardKind } from '../model/game'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore } from './store'

const AWARDS: { kind: AwardKind; label: string }[] = [
  { kind: 'longestRoad', label: 'Longest road' },
  { kind: 'largestArmy', label: 'Largest army' },
]

export function AwardControls() {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  const standings = computeStandings(game)
  if (AWARDS.every(({ kind }) => awardCandidates(game, kind).length === 0)) return null
  return (
    <details className="award-controls">
      <summary>Award holders</summary>
      {AWARDS.map(({ kind, label }) => {
        const candidates = awardCandidates(game, kind)
        const holder = standings.find((standing) => kind === 'longestRoad' ? standing.hasLongestRoad : standing.hasLargestArmy)
        const options = candidates.map((id) => ({ value: id, label: game.board.players.find((player) => player.id === id)!.name }))
        return (
          <div key={kind}>
            <span>{label}</span>
            <MenuSelect ariaLabel={`${label} holder`} value={holder?.playerId ?? ''}
              options={candidates.length === 1 ? options : [{ value: '', label: candidates.length === 0 ? 'None' : 'Unknown' }, ...options]}
              onSelect={(id) => dispatch({ type: 'commit-game', game: setAwardHolder(game, kind, id || null) })}>
              {holder ? game.board.players.find((player) => player.id === holder.playerId)?.name : candidates.length === 0 ? 'None' : 'Unknown'}
            </MenuSelect>
          </div>
        )
      })}
    </details>
  )
}
