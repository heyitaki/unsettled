import type { Player } from '../model/types'
import type { ParseIssue } from './sources/types'

export function synthesizeRoster(
  players: Player[], detected: Player[], issues: ParseIssue[], maxPlayers = Infinity,
): boolean {
  const initial = players.length
  for (const player of detected) {
    if (players.length >= maxPlayers || players.some((entry) => entry.id === player.id)) continue
    players.push(player)
    if (initial > 0) issues.push({
      stage: 'roster',
      severity: 'warning',
      message: `Synthesized a player for an unmatched ${player.name.toLowerCase()} piece`,
    })
  }
  if (initial === 0) issues.push({
    stage: 'roster',
    severity: 'warning',
    message: 'Roster was synthesized from detected pieces',
  })
  return players.length > initial
}
