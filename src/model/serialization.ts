import { validateBoard } from './board'
import type { AxialCoord, Board, Building, Hex, Player, Port, Road } from './types'

export type ParseBoardResult =
  | { ok: true; board: Board }
  | { ok: false; errors: string[] }

export const serializeBoard = (board: Board): string => JSON.stringify(board, null, 2)

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

const isPort = (value: unknown): value is Port =>
  isRecord(value) && exactKeys(value, ['edgeId', 'resource', 'rate']) &&
  typeof value.edgeId === 'string' && value.edgeId.startsWith('e:') &&
  (value.resource === null || ['wood', 'sheep', 'wheat', 'brick', 'ore'].includes(String(value.resource))) &&
  Number.isInteger(value.rate)

const isRoad = (value: unknown): value is Road =>
  isRecord(value) && exactKeys(value, ['edgeId', 'playerId']) &&
  typeof value.edgeId === 'string' && value.edgeId.startsWith('e:') && typeof value.playerId === 'string'

const isBuilding = (value: unknown): value is Building =>
  isRecord(value) && exactKeys(value, ['vertexId', 'playerId', 'tier']) &&
  typeof value.vertexId === 'string' && value.vertexId.startsWith('v:') &&
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
  }
  const errors = structuralErrors(value)
  if (errors.length > 0) return { ok: false, errors }
  const board = value as Board
  const issues = validateBoard(board)
  const invariantErrors = issues.filter((issue) => issue.severity === 'error')
  if (invariantErrors.length > 0) return { ok: false, errors: invariantErrors.map((issue) => issue.message) }
  return { ok: true, board }
}
