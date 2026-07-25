import { validateBoard } from './board'
import { parseEdgeId, parseVertexId } from './coords'
import { newGame, reconcileStats, validateGameStats, type Game, type PlayerStats } from './game'
import { RESOURCES, type AxialCoord, type Board, type Building, type Hex, type Player, type Port, type Road } from './types'

export type ParseBoardResult =
  | { ok: true; board: Board }
  | { ok: false; errors: string[] }

export type ParseGameResult =
  | { ok: true; game: Game }
  | { ok: false; errors: string[] }

export const serializeBoard = (board: Board): string => JSON.stringify(board, null, 2)

export const serializeGame = (game: Game): string => JSON.stringify(game, null, 2)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key)
}

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

const isPlayerStats = (value: unknown): value is PlayerStats =>
  isRecord(value) && exactKeys(value, ['hand', 'devCards', 'knights', 'vpCards']) &&
  isRecord(value.hand) && exactKeys(value.hand, RESOURCES) &&
  RESOURCES.every((resource) => isCount((value.hand as Record<string, unknown>)[resource])) &&
  isCount(value.devCards) && isCount(value.knights) && isCount(value.vpCards)

/**
 * Parse a persisted or pasted game. Accepts either the Game envelope or a bare
 * legacy Board (everything saved before games existed), which is wrapped with
 * zero-filled stats. Stats entries are validated strictly, but a game whose
 * stats are missing roster entries is repaired by zero-filling rather than
 * rejected — absence of data is benign, unlike malformed data.
 */
export function parseGame(data: unknown): ParseGameResult {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return { ok: false, errors: ['Invalid JSON'] }
    }
  }
  // Bare boards carry their hexes at the top level; the Game envelope nests
  // everything under `board`.
  if (isRecord(value) && !('board' in value)) {
    const parsed = parseBoard(value)
    return parsed.ok ? { ok: true, game: newGame(parsed.board) } : parsed
  }
  if (!isRecord(value)) return { ok: false, errors: ['Game must be an object'] }
  if (value.schemaVersion !== 1) return { ok: false, errors: ['Unsupported game schemaVersion, expected 1'] }
  if (!exactKeys(value, ['schemaVersion', 'board', 'stats'])) {
    return { ok: false, errors: ['Game contains missing or unknown top-level fields'] }
  }
  const parsedBoard = parseBoard(value.board)
  if (!parsedBoard.ok) return parsedBoard
  if (!isRecord(value.stats) || !Object.values(value.stats).every(isPlayerStats)) {
    return { ok: false, errors: ['Invalid player stats'] }
  }
  // Cloned for the same ownership reason as the board above.
  const stats = structuredClone(value.stats) as Record<string, PlayerStats>
  const game: Game = {
    schemaVersion: 1,
    board: parsedBoard.board,
    stats: reconcileStats(stats, parsedBoard.board.players),
  }
  // reconcileStats zero-fills missing entries, so any surviving issue is a
  // stats key pointing at a player outside the roster.
  const statErrors = validateGameStats({ ...game, stats })
    .filter((issue) => issue.code === 'stats-unknown-player')
  if (statErrors.length > 0) return { ok: false, errors: statErrors.map((issue) => issue.message) }
  return { ok: true, game }
}
