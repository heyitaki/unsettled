import { draftOrder, placeBuilding, placeRoad, removeBuilding, removeRoad } from '../model/board'
import { edgeEndpointVertexIds } from '../model/coords'
import type { Board, EdgeId, VertexId } from '../model/types'

export type DraftWarning = 'snake-inconsistent' | 'non-settlement-buildings' | 'solo-roster'

export interface DraftState {
  sequence: string[]
  placedCount: number
  turnIndex: number | null
  currentPlayerId: string | null
  myPickIndices: number[]
  myRemainingPickIndices: number[]
  remainingPickIndices: number[]
  warnings: DraftWarning[]
}

export interface DraftPick {
  vertexId: VertexId
  playerId: string
  roads: EdgeId[]
}

export function lastDraftPick(board: Board): DraftPick | null {
  if (board.buildings.length === 0 || board.buildings.some((building) => building.tier !== 'settlement')) return null
  const { sequence, placedCount } = inferDraftState(board)
  if (board.buildings.length > sequence.length) return null
  const picker = sequence[placedCount - 1]
  const due = sequence.slice(0, placedCount).filter((playerId) => playerId === picker).length
  const placed = board.buildings.filter((candidate) => candidate.playerId === picker)
  // The snake names the picker only while that player has placed as often as it says. Short of
  // that, someone else holds the extra settlement, and taking the picker's would remove a pick
  // the board does not have too many of, so the settlement added last goes instead.
  const building = placed.length === due ? placed[placed.length - 1] : board.buildings[board.buildings.length - 1]
  return {
    vertexId: building.vertexId,
    playerId: building.playerId,
    roads: board.roads
      .filter((road) => road.playerId === building.playerId && edgeEndpointVertexIds(road.edgeId).includes(building.vertexId))
      .map((road) => road.edgeId),
  }
}

export function removeDraftPick(board: Board, pick: DraftPick): Board {
  return pick.roads.reduce((next, edgeId) => removeRoad(next, edgeId), removeBuilding(board, pick.vertexId))
}

export function restoreDraftPick(board: Board, pick: DraftPick): Board {
  return pick.roads.reduce((next, edgeId) => placeRoad(next, edgeId, pick.playerId),
    placeBuilding(board, pick.vertexId, pick.playerId, 'settlement'))
}

const draftIsOver = (board: Board, placedCount: number, sequenceLength: number): boolean =>
  placedCount >= sequenceLength ||
  board.buildings.some((building) => building.tier === 'city' || building.tier === 'superCity')

export function inferDraftState(board: Board): DraftState {
  const sequence = draftOrder(board)
  const settlements = board.buildings.filter((building) => building.tier === 'settlement')
  const placedCount = Math.min(settlements.length, sequence.length)
  const warnings: DraftWarning[] = []
  if (board.buildings.some((building) => building.tier !== 'settlement')) {
    warnings.push('non-settlement-buildings')
  }
  if (board.players.length === 1) warnings.push('solo-roster')

  const expected = new Map<string, number>()
  for (const playerId of sequence.slice(0, placedCount)) {
    expected.set(playerId, (expected.get(playerId) ?? 0) + 1)
  }
  const actual = new Map<string, number>()
  for (const settlement of settlements) {
    actual.set(settlement.playerId, (actual.get(settlement.playerId) ?? 0) + 1)
  }
  const owners = new Set([...expected.keys(), ...actual.keys()])
  // Only meaningful while the draft is still running: once it is over, building
  // counts drift from the snake through ordinary play (upgrades to cities, extra
  // settlements), and reading that as a broken draft order is just noise.
  if (
    !draftIsOver(board, placedCount, sequence.length) &&
    [...owners].some((playerId) => (expected.get(playerId) ?? 0) !== (actual.get(playerId) ?? 0))
  ) {
    warnings.push('snake-inconsistent')
  }

  const turnIndex = placedCount < sequence.length ? placedCount : null
  const total = new Map<string, number>()
  for (const playerId of sequence) {
    total.set(playerId, (total.get(playerId) ?? 0) + 1)
  }
  const skips = new Map<string, number>()
  for (const [playerId, totalPicks] of total) {
    const actualPlaced = Math.min(actual.get(playerId) ?? 0, totalPicks)
    const expectedPlaced = expected.get(playerId) ?? 0
    const excess = actualPlaced - expectedPlaced
    if (excess > 0) skips.set(playerId, excess)
  }
  const remainingPickIndices: number[] = []
  if (turnIndex !== null) {
    for (let index = turnIndex; index < sequence.length; index += 1) {
      const playerId = sequence[index]
      const skip = skips.get(playerId) ?? 0
      if (skip > 0) {
        skips.set(playerId, skip - 1)
        continue
      }
      remainingPickIndices.push(index)
    }
  }
  const meValid = board.mePlayerId !== null && board.players.some((player) => player.id === board.mePlayerId)
  const myPickIndices = meValid
    ? sequence.flatMap((playerId, index) => playerId === board.mePlayerId ? [index] : [])
    : []
  const myRemainingPickIndices = meValid
    ? remainingPickIndices.filter((index) => sequence[index] === board.mePlayerId)
    : []

  return {
    sequence,
    placedCount,
    turnIndex,
    currentPlayerId: turnIndex === null ? null : sequence[turnIndex],
    myPickIndices,
    myRemainingPickIndices,
    remainingPickIndices,
    warnings,
  }
}

export const draftIsComplete = (board: Board, draft: DraftState): boolean =>
  draftIsOver(board, draft.placedCount, draft.sequence.length)
