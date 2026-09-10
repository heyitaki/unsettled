import { createBoard, validateBoard } from './board'
import { parseEdgeId, parseVertexId } from './coords'
import { newGame, reconcileStats, validateGameStats, type AwardHolders, type Game, type PlayerStats } from './game'
import { RESOURCES, type AxialCoord, type Board, type Building, type Hex, type LayoutId, type Player, type Port, type Road } from './types'

type ParseBoardResult =
  | { ok: true; board: Board }
  | { ok: false; errors: string[] }

export type ParseGameResult =
  | { ok: true; game: Game }
  | { ok: false; errors: string[] }

export const serializeGame = (game: Game): string => JSON.stringify(game, null, 2)

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const isCoord = (value: unknown): value is AxialCoord =>
  isRecord(value) && exactKeys(value, ['q', 'r']) && Number.isInteger(value.q) && Number.isInteger(value.r)

const isHex = (value: unknown): value is Hex =>
  isRecord(value) && exactKeys(value, ['coord', 'tile', 'numberToken']) && isCoord(value.coord) &&
  (value.tile === null || ['wood', 'sheep', 'wheat', 'brick', 'ore', 'desert'].includes(String(value.tile))) &&
  (value.numberToken === null || Number.isInteger(value.numberToken))

// Piece ids must round-trip through the canonical parsers: this rejects both
// garbage coordinates (which would make downstream geometry helpers throw)
// and non-canonical orderings that would evade validateBoard's duplicate and
// adjacency checks, which compare ids as strings.
const isCanonicalId = (value: unknown, parse: (id: string) => unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parse(value)
    return true
  } catch {
    return false
  }
}

const isPort = (value: unknown): value is Port =>
  isRecord(value) && exactKeys(value, ['edgeId', 'resource', 'rate']) &&
  isCanonicalId(value.edgeId, parseEdgeId) &&
  (value.resource === null || ['wood', 'sheep', 'wheat', 'brick', 'ore'].includes(String(value.resource))) &&
  Number.isInteger(value.rate)

const isRoad = (value: unknown): value is Road =>
  isRecord(value) && exactKeys(value, ['edgeId', 'playerId']) &&
  isCanonicalId(value.edgeId, parseEdgeId) && typeof value.playerId === 'string'

const isBuilding = (value: unknown): value is Building =>
  isRecord(value) && exactKeys(value, ['vertexId', 'playerId', 'tier']) &&
  isCanonicalId(value.vertexId, parseVertexId) &&
  typeof value.playerId === 'string' && ['settlement', 'city', 'superCity'].includes(String(value.tier))

const isPlayer = (value: unknown): value is Player =>
  isRecord(value) && exactKeys(value, ['id', 'name', 'color']) &&
  typeof value.id === 'string' && typeof value.name === 'string' && typeof value.color === 'string'

function structuralErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['Board must be an object']
  if (value.schemaVersion !== 1) return ['Unsupported schemaVersion, expected 1']
  if (!exactKeys(value, ['schemaVersion', 'layout', 'hexes', 'ports', 'robber', 'roads', 'buildings', 'players', 'mePlayerId'])) {
    return ['Board contains missing or unknown top-level fields']
  }
  const errors: string[] = []
  if (value.layout !== 'standard4' && value.layout !== 'extension6') errors.push('Invalid layout')
  if (!Array.isArray(value.hexes) || !value.hexes.every(isHex)) errors.push('Invalid hexes')
  if (!Array.isArray(value.ports) || !value.ports.every(isPort)) errors.push('Invalid ports')
  if (value.robber !== null && !isCoord(value.robber)) errors.push('Invalid robber')
  if (!Array.isArray(value.roads) || !value.roads.every(isRoad)) errors.push('Invalid roads')
  if (!Array.isArray(value.buildings) || !value.buildings.every(isBuilding)) errors.push('Invalid buildings')
  if (!Array.isArray(value.players) || !value.players.every(isPlayer)) errors.push('Invalid players')
  if (value.mePlayerId !== null && typeof value.mePlayerId !== 'string') errors.push('Invalid mePlayerId')
  return errors
}

export function parseBoard(data: unknown): ParseBoardResult {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return { ok: false, errors: ['Invalid JSON'] }
    }
  } else {
    // Own the result outright. A caller that keeps a handle on the object it
    // passed in must not be able to mutate a live Board afterwards: the analysis
    // and standings caches both key on board/game identity.
    value = structuredClone(data)
  }
  const errors = structuralErrors(value)
  if (errors.length > 0) return { ok: false, errors }
  const board = value as Board
  const issues = validateBoard(board)
  const invariantErrors = issues.filter((issue) => issue.severity === 'error')
  if (invariantErrors.length > 0) return { ok: false, errors: invariantErrors.map((issue) => issue.message) }
  return { ok: true, board }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

function normalizePlayerStats(value: unknown): PlayerStats | null {
  if (!isRecord(value)) return null
  if (!exactKeys(value, ['hand', 'devCards', 'knights', 'vpCards', 'handUnknown'])) return null
  const hand = value.hand
  if (!isRecord(hand) || !exactKeys(hand, RESOURCES) ||
    !isCount(hand.wood) || !isCount(hand.sheep) || !isCount(hand.wheat) ||
    !isCount(hand.brick) || !isCount(hand.ore) ||
    !isCount(value.devCards) || !isCount(value.knights) || !isCount(value.vpCards) ||
    !isCount(value.handUnknown)) {
    return null
  }
  return {
    hand: { wood: hand.wood, sheep: hand.sheep, wheat: hand.wheat, brick: hand.brick, ore: hand.ore },
    handUnknown: value.handUnknown,
    devCards: value.devCards,
    knights: value.knights,
    vpCards: value.vpCards,
  }
}

/** Parse a game, zero-filling missing roster stats while rejecting malformed data. */
export function parseGame(data: unknown): ParseGameResult {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return { ok: false, errors: ['Invalid JSON'] }
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ['Game must be an object'] }
  if (value.schemaVersion !== 1) return { ok: false, errors: ['Unsupported game schemaVersion, expected 1'] }
  if (!exactKeys(value, ['schemaVersion', 'board', 'stats']) && !exactKeys(value, ['schemaVersion', 'board', 'stats', 'awards'])) {
    return { ok: false, errors: ['Game contains missing or unknown top-level fields'] }
  }
  const parsedBoard = parseBoard(value.board)
  if (!parsedBoard.ok) return parsedBoard
  let awards: AwardHolders | undefined
  if ('awards' in value) {
    if (!isRecord(value.awards) || !exactKeys(value.awards, ['longestRoad', 'largestArmy'])) {
      return { ok: false, errors: ['Invalid award holders'] }
    }
    const { longestRoad, largestArmy } = value.awards
    const validHolder = (id: unknown): id is string | null => id === null ||
      typeof id === 'string' && parsedBoard.board.players.some((player) => player.id === id)
    if (!validHolder(longestRoad) || !validHolder(largestArmy)) return { ok: false, errors: ['Award holder is not in the roster'] }
    awards = { longestRoad, largestArmy }
  }
  if (!isRecord(value.stats)) {
    return { ok: false, errors: ['Invalid player stats'] }
  }

  // Normalization rebuilds the stats graph so parsed games never alias input.
  const normalizedEntries = Object.entries(value.stats).map(([id, stats]) => {
    const normalized = normalizePlayerStats(stats)
    return normalized ? [id, normalized] as const : null
  })
  if (normalizedEntries.some((entry) => entry === null)) {
    return { ok: false, errors: ['Invalid player stats'] }
  }
  const stats = Object.fromEntries(normalizedEntries as [string, PlayerStats][])
  const game: Game = {
    schemaVersion: 1,
    board: parsedBoard.board,
    stats: reconcileStats(stats, parsedBoard.board.players),
    ...(awards === undefined ? {} : { awards }),
  }
  // reconcileStats zero-fills missing entries, so any surviving issue is a
  // stats key pointing at a player outside the roster.
  const statErrors = validateGameStats({ ...game, stats })
    .filter((issue) => issue.code === 'stats-unknown-player')
  if (statErrors.length > 0) return { ok: false, errors: statErrors.map((issue) => issue.message) }
  return { ok: true, game }
}

// Memoized on game identity: games are immutable, and the UI compares
// signatures on every render and autosave.
const signatures = new WeakMap<Game, string>()

export function gameSignature(game: Game): string {
  const cached = signatures.get(game)
  if (cached !== undefined) return cached
  const value = serializeGame(game)
  signatures.set(game, value)
  return value
}

// One fresh game per layout, rather than building and serializing a
// throwaway baseline for every unlinked tab on every render.
const fresh = new Map<LayoutId, string>()

/** Nothing beyond a fresh board of its layout: the autosave and a backup both leave such a tab out. */
export function isFreshGame(game: Game): boolean {
  const { layout } = game.board
  let baseline = fresh.get(layout)
  if (baseline === undefined) {
    baseline = serializeGame(newGame(createBoard(layout)))
    fresh.set(layout, baseline)
  }
  return gameSignature(game) === baseline
}
