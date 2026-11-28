// A Game wraps a Board with the per-player state that cannot be derived from
// the pieces on the board: resource hands, dev cards, knights played, and VP
// dev cards. The library and workspace persist whole games so a session can be
// resumed mid-play; the Board schema itself stays untouched (parser fixtures
// and geometry validation are unaffected).

import { setupGrants } from './board'
import { RESOURCES, type AxialCoord, type Board, type Building, type Issue, type Player, type Resource, type Road } from './types'

export interface PlayerStats {
  hand: Record<Resource, number>
  /** Cards known to be held but not to be of a known resource. A screenshot import reads only the total. */
  handUnknown: number
  devCards: number
  knights: number
  vpCards: number
}

export const DEV_KINDS = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const
export type DevKind = (typeof DEV_KINDS)[number]

export const CORRECTION_FIELDS = [...RESOURCES, 'handUnknown', ...DEV_KINDS, 'devCards', 'knights', 'vpCards'] as const
export type CorrectionField = (typeof CORRECTION_FIELDS)[number]

export interface Correction {
  changes: Record<string, Partial<Record<CorrectionField, number>>>
  awards?: Partial<Record<AwardKind, string>>
}

export function isEmptyCorrection(correction: Correction): boolean {
  return Object.keys(correction.changes).length === 0 && correction.awards === undefined
}

/** The five and six player special building phase, asked when a screenshot import starts a game. Absent means off. */
export interface SpecialBuildRule {
  /** `everyTurn`: after each turn every other player may build. `across`: after a turn, only the player three seats back builds, so each player gets one build where their turn would fall on a four player board. */
  timing: 'everyTurn' | 'across'
  /** `overSeven`: only a player holding more than seven cards may build. */
  who: 'overSeven' | 'always'
}

/** A build or dev card buy recorded for another player after the turn player finished. */
export interface SpecialBuildLine {
  playerId: string
  text: string
}

export interface TurnState {
  /** Whose turn it is. Advice and recorded actions are for this player. */
  playerId: string
  /** This turn's dice total, null before the roll. */
  rolled: number | null
  log?: string[]
  /** Net ledger edits since the last recorded action. */
  correction?: Correction
  gains?: Record<string, Partial<Record<Resource, number>>>
  /** After a 7: false until the robber is placed. Absent on any other roll. */
  robberMoved?: boolean
  /** Dev cards bought this turn, which cannot be played until the next one. */
  devBought?: number
  devPlayed: boolean
  /** Progress cards (not knights) recorded as played over the whole game: they have left the dev deck. */
  progressPlayed: Record<Exclude<DevKind, 'knight'>, number>
  specialBuilds?: SpecialBuildLine[]
}

/** The claimed player's dev cards by type. VP cards stay in PlayerStats.vpCards. */
export interface DevHand {
  playerId: string
  playable: Record<DevKind, number>
  /** Bought this turn, so not playable until the turn ends. */
  bought: Record<DevKind, number>
}

export interface Game {
  schemaVersion: 1
  board: Board
  stats: Record<string, PlayerStats>
  /** Absent in legacy snapshots. Null records an award with no known holder. */
  awards?: AwardHolders
  /** Absent until `Start game`, and in saves older than turn tracking, where it reads as the claimed player's turn, not yet rolled. */
  turn?: TurnState
  /** Absent until the claimed player's dev cards are entered by type. */
  devHand?: DevHand
  history?: GameHistory
  /** The screenshot read behind this game's open import questions, in this game's player ids; absent once answered or skipped. */
  pendingImport?: ScreenshotRead
  avatars?: Record<string, string>
  specialBuild?: SpecialBuildRule
}

export interface Position {
  buildings: Building[]
  roads: Road[]
  robber: AxialCoord | null
  stats: Record<string, PlayerStats>
  awards?: AwardHolders
  devHand?: DevHand
}

export interface TurnRecord {
  playerId: string
  rolled: number | null
  gains?: TurnState['gains']
  log: string[]
  specialBuilds?: SpecialBuildLine[]
  buildings?: Record<string, Building | null>
  roads?: Record<string, string | null>
  robber: AxialCoord | null
  /** Only the players whose stats changed since the previous record; null for a player who left the roster. */
  stats?: Record<string, PlayerStats | null>
  awards?: AwardHolders
  devHand?: DevHand
}

export interface GameHistory {
  start: Position
  turns: TurnRecord[]
}

export interface AwardHolders {
  longestRoad: string | null
  largestArmy: string | null
}

export type AwardKind = keyof AwardHolders

export type StatCounter = 'handUnknown' | 'devCards' | 'knights' | 'vpCards'

export function emptyStats(): PlayerStats {
  const hand = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
  return { hand, handUnknown: 0, devCards: 0, knights: 0, vpCards: 0 }
}

export function devHandTotal(hand: DevHand): number {
  return DEV_KINDS.reduce((sum, kind) => sum + hand.playable[kind] + hand.bought[kind], 0)
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
  let stats = reconcileStats(game.stats, board.players)

  // Only hands still matching the previous setup grant follow draft edits.
  if (game.turn === undefined && board !== game.board) {
    const oldGrants = setupGrants(game.board)
    const newGrants = setupGrants(board)
    for (const { id } of board.players) {
      const current = stats[id]
      const oldHand = oldGrants && Object.hasOwn(oldGrants, id) ? oldGrants[id] : emptyStats().hand
      const hand = newGrants?.[id] ?? emptyStats().hand
      if (current.handUnknown === 0
        && RESOURCES.every((resource) => current.hand[resource] === oldHand[resource])
        && RESOURCES.some((resource) => current.hand[resource] !== hand[resource])) {
        if (stats === game.stats) stats = { ...stats }
        stats[id] = { ...current, hand }
      }
    }
  }
  return replaceBoard(game, board, stats)
}

function replaceBoard(game: Game, board: Board, stats: Record<string, PlayerStats>): Game {
  const dropTurn = game.turn !== undefined && !Object.hasOwn(stats, game.turn.playerId)
  const dropDevHand = game.devHand !== undefined && !Object.hasOwn(stats, game.devHand.playerId)
  const pruneAvatars = game.avatars !== undefined && Object.keys(game.avatars).some((id) => !Object.hasOwn(stats, id))
  if (board === game.board && stats === game.stats && !dropTurn && !dropDevHand && !pruneAvatars) return game
  const next = { ...game, board, stats }
  if (dropTurn) delete next.turn
  if (dropDevHand) delete next.devHand
  if (next.pendingImport && board.players !== game.board.players) {
    const read = next.pendingImport
    const inRoster = (id: string) => Object.hasOwn(stats, id)
    next.pendingImport = {
      ...read,
      hands: read.hands.filter(inRoster),
      unorderedPicks: read.unorderedPicks.filter(inRoster),
      knights: read.knights.filter(inRoster),
      points: Object.fromEntries(Object.entries(read.points).filter(([id]) => inRoster(id))),
    }
  }
  if (pruneAvatars) next.avatars = Object.fromEntries(Object.entries(game.avatars!).filter(([id]) => Object.hasOwn(stats, id)))
  return next
}

/** What a screenshot supplied, which the parsed Game cannot say for itself. */
export interface ScreenshotRead {
  /** False when any players were identified only from piece colours. */
  roster: boolean
  /** Whether the screenshot showed turn order. Implies `roster`. */
  order: boolean
  /** Whether the screenshot showed which settlement each player placed first. */
  picks: boolean
  /** Parsed ids of the players whose hand size was read. A zero hand is otherwise the same as an unread one. */
  hands: readonly string[]
  /** Parsed ids of players with two settlements whose placement order was unread. */
  unorderedPicks: readonly string[]
  /** Parsed player ids to the victory points shown, only when read. */
  points: Readonly<Record<string, number>>
  /** Parsed ids of players whose knights-played count was read. */
  knights: readonly string[]
}

/**
 * Fold a later screenshot of a saved game into it. The screenshot wins on what
 * it shows: the roster and its order, the pieces, the robber and each hand's
 * size. The saved game keeps names, the claim, dev cards, knights, VP cards,
 * awards and the recorded turn. It also keeps what this screenshot failed to
 * read: a hand missing from `read.hands`, and a robber nobody found. Without
 * turn order, surviving saved players keep their order and newcomers follow in
 * screenshot order. Without pick order, buildings at saved vertices with the
 * same owner come first in saved order, taking the screenshot's tiers; other
 * buildings follow in screenshot order.
 *
 * Players are matched by colour and a match keeps its saved id and name.
 */
export function mergeScreenshot(saved: Game, shot: Game, read: ScreenshotRead): Game {
  const byColor = new Map<string, Player>()
  for (const player of saved.board.players) if (!byColor.has(player.color)) byColor.set(player.color, player)
  // Every saved id is reserved, matched or not: a newcomer handed a departed
  // player's id would inherit that player's turn and dev hand.
  const taken = new Set(saved.board.players.map((player) => player.id))
  const handRead = new Set(read.hands)
  // Screenshot id to merged id, for the pieces and the claim.
  const ids = new Map<string, string>()
  const stats = new Map<string, PlayerStats>()
  const newcomers: Player[] = []
  const shotPlayers = shot.board.players.map((player) => {
    const match = byColor.get(player.color)
    let id = match?.id ?? player.id
    if (match === undefined) for (let n = 2; taken.has(id); n += 1) id = `${player.id}-${n}`
    taken.add(id)
    ids.set(player.id, id)
    const merged = { ...player, id, name: match?.name ?? player.name }
    const shotStats = shot.stats[player.id]
    if (match === undefined) {
      newcomers.push(merged)
      stats.set(id, shotStats)
    } else if (handRead.has(player.id)) {
      // Known cards stay known while the new hand size has room for them.
      const savedStats = saved.stats[id]
      const known = Object.values(savedStats.hand).reduce((sum, cards) => sum + cards, 0)
      stats.set(id, shotStats.handUnknown >= known
        ? { ...savedStats, handUnknown: shotStats.handUnknown - known }
        : { ...savedStats, hand: shotStats.hand, handUnknown: shotStats.handUnknown })
    }
    return merged
  })

  // Without turn order, saved seats stay in order; without a roster, nobody leaves.
  const players = read.order ? shotPlayers : [
    ...saved.board.players.filter((player) => !read.roster || shotPlayers.some((shot) => shot.id === player.id)),
    ...newcomers,
  ]
  const remapOwner = <T extends { playerId: string }>(piece: T): T =>
    ({ ...piece, playerId: ids.get(piece.playerId) ?? piece.playerId })
  let buildings = shot.board.buildings.map(remapOwner)
  if (!read.picks) {
    const remaining = new Map(buildings.map((building) => [building.vertexId, building]))
    const retained = saved.board.buildings.flatMap((building) => {
      const match = remaining.get(building.vertexId)
      if (!match || match.playerId !== building.playerId) return []
      remaining.delete(building.vertexId)
      return [match]
    })
    buildings = [...retained, ...remaining.values()]
  }
  const savedClaim = saved.board.mePlayerId
  const claim = savedClaim !== null && players.some((player) => player.id === savedClaim)
    ? savedClaim
    : ids.get(shot.board.mePlayerId ?? '') ?? null
  // Not withBoard: a screenshot says what each hand holds now, so no hand follows the draft here.
  const merged = replaceBoard(saved, {
    ...shot.board,
    robber: shot.board.robber ?? saved.board.robber,
    players,
    roads: shot.board.roads.map(remapOwner),
    buildings,
    mePlayerId: claim,
  }, Object.fromEntries(players.map((player) => [player.id, stats.get(player.id) ?? saved.stats[player.id]])))
  const avatars = Object.fromEntries(shot.board.players.flatMap((player) => {
    const print = shot.avatars?.[player.id]
    return typeof print === 'string' ? [[ids.get(player.id)!, print]] : []
  }))
  if (Object.keys(avatars).length > 0) merged.avatars = { ...merged.avatars, ...avatars }
  return merged
}

export function ensureStats(game: Game, playerId: string): PlayerStats {
  if (!Object.hasOwn(game.stats, playerId)) throw new RangeError(`Unknown player ${playerId}`)
  return game.stats[playerId]
}

function withPlayerStats(game: Game, playerId: string, stats: PlayerStats): Game {
  const next = { ...game, stats: { ...game.stats, [playerId]: stats } }
  const hand = game.devHand

  // The public count is authoritative when the entered types no longer fit.
  if (hand?.playerId === playerId && devHandTotal(hand) > stats.devCards) delete next.devHand
  return next
}

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
