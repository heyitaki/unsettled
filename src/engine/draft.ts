import { draftOrder } from '../model/board'
import type { Board } from '../model/types'

export type DraftWarning = 'snake-inconsistent' | 'non-settlement-buildings' | 'solo-roster'

export interface DraftState {
  sequence: string[]
  placedCount: number
  turnIndex: number | null
  currentPlayerId: string | null
  myPickIndices: number[]
  myRemainingPickIndices: number[]
  warnings: DraftWarning[]
}

export function inferDraftState(board: Board): DraftState {
  const sequence = draftOrder(board, 2)
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
  if ([...owners].some((playerId) => (expected.get(playerId) ?? 0) !== (actual.get(playerId) ?? 0))) {
    warnings.push('snake-inconsistent')
  }

  const turnIndex = placedCount < sequence.length ? placedCount : null
  const meValid = board.mePlayerId !== null && board.players.some((player) => player.id === board.mePlayerId)
  const myPickIndices = meValid
    ? sequence.flatMap((playerId, index) => playerId === board.mePlayerId ? [index] : [])
    : []
  const myPlacedCount = meValid
    ? Math.min(
        settlements.filter((building) => building.playerId === board.mePlayerId).length,
        myPickIndices.length,
      )
    : 0
  const remainingCount = myPickIndices.length - myPlacedCount
  const candidates = turnIndex === null ? [] : myPickIndices.filter((index) => index >= turnIndex)
  const myRemainingPickIndices = candidates.slice(Math.max(0, candidates.length - remainingCount))

  return {
    sequence,
    placedCount,
    turnIndex,
    currentPlayerId: turnIndex === null ? null : sequence[turnIndex],
    myPickIndices,
    myRemainingPickIndices,
    warnings,
  }
}

export const draftIsComplete = (board: Board, draft: DraftState): boolean =>
  draft.placedCount >= draft.sequence.length ||
  board.buildings.some((building) => building.tier === 'city' || building.tier === 'superCity')
