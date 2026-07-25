// A Game wraps a Board with the per-player state that cannot be derived from
// the pieces on the board: resource hands, dev cards, knights played, and VP
// dev cards. The library and workspace persist whole games so a session can be
// resumed mid-play; the Board schema itself stays untouched (parser fixtures
// and geometry validation are unaffected).

import { RESOURCES, type Board, type Issue, type Player, type Resource } from './types'

export interface PlayerStats {
  hand: Record<Resource, number>
  devCards: number
  knights: number
  vpCards: number
}

export interface Game {
  schemaVersion: 1
  board: Board
  stats: Record<string, PlayerStats>
}

export type StatCounter = 'devCards' | 'knights' | 'vpCards'

export function emptyStats(): PlayerStats {
  const hand = Object.fromEntries(RESOURCES.map((resource) => [resource, 0])) as Record<Resource, number>
  return { hand, devCards: 0, knights: 0, vpCards: 0 }
}

/**
 * Align a stats record with a roster: keep entries for players still present,
 * zero-fill players that lack one, and drop entries for departed players.
 * Returns the input record unchanged (same reference) when already aligned, so
 * callers can use identity to detect no-ops.
 */
export function reconcileStats(
  stats: Record<string, PlayerStats>,
  players: readonly Player[],
): Record<string, PlayerStats> {
  const ids = players.map((player) => player.id)
  // hasOwn, not `in`/`??`: a player id like "toString" or "valueOf" would
  // otherwise resolve to the Object.prototype member, so the roster would look
  // aligned and the player's stats would be a function instead of a record.
  const aligned = ids.length === Object.keys(stats).length && ids.every((id) => Object.hasOwn(stats, id))
  if (aligned) return stats
  return Object.fromEntries(ids.map((id) => [id, Object.hasOwn(stats, id) ? stats[id] : emptyStats()]))
}

export const newGame = (board: Board): Game => ({
  schemaVersion: 1,
  board,
  stats: reconcileStats({}, board.players),
})

/**
 * Replace the game's board, reconciling stats against the (possibly changed)
 * roster. The single write path for board edits: routing every board mutation
 * through here is what guarantees stats never dangle or go missing. Returns
 * the same game reference when nothing changed.
 */
export function withBoard(game: Game, board: Board): Game {
  const stats = reconcileStats(game.stats, board.players)
  if (board === game.board && stats === game.stats) return game
  return { ...game, board, stats }
}

function ensureStats(game: Game, playerId: string): PlayerStats {
  if (!Object.hasOwn(game.stats, playerId)) throw new RangeError(`Unknown player ${playerId}`)
  return game.stats[playerId]
}

const withPlayerStats = (game: Game, playerId: string, stats: PlayerStats): Game => ({
  ...game,
  stats: { ...game.stats, [playerId]: stats },
})

// Deltas clamp at zero rather than throwing: steppers in the UI can always
// fire a decrement without first checking the current count.
export function adjustHand(game: Game, playerId: string, resource: Resource, delta: number): Game {
  const stats = ensureStats(game, playerId)
  const count = Math.max(0, stats.hand[resource] + delta)
  if (count === stats.hand[resource]) return game
  return withPlayerStats(game, playerId, { ...stats, hand: { ...stats.hand, [resource]: count } })
}

export function adjustCounter(game: Game, playerId: string, counter: StatCounter, delta: number): Game {
  const stats = ensureStats(game, playerId)
  const count = Math.max(0, stats[counter] + delta)
  if (count === stats[counter]) return game
  return withPlayerStats(game, playerId, { ...stats, [counter]: count })
}

/** Game-level invariants beyond validateBoard: stats keys must match the roster. */
export function validateGameStats(game: Game): Issue[] {
  const issues: Issue[] = []
  const roster = new Set(game.board.players.map((player) => player.id))
  for (const id of Object.keys(game.stats)) {
    if (!roster.has(id)) issues.push({ severity: 'error', code: 'stats-unknown-player', message: `Stats reference unknown player ${id}` })
  }
  for (const id of roster) {
    if (!Object.hasOwn(game.stats, id)) issues.push({ severity: 'error', code: 'stats-missing-player', message: `Player ${id} has no stats entry` })
  }
  return issues
}
