import { draftIsComplete, type DraftState } from '../engine/draft'
import type { Board } from '../model/types'

/** One pick of the snake draft, as the draft grid and the ribbon draw it. */
export interface DraftSlot {
  playerId: string
  placed: boolean
  mine: boolean
  current: boolean
}

export function draftSlots(board: Board, draft: DraftState): DraftSlot[] {
  const complete = draftIsComplete(board, draft)
  const placedByPlayer = new Map<string, number>()

  // Upgraded starting settlements still count once the draft is over.
  for (const building of board.buildings) {
    if (!complete && building.tier !== 'settlement') continue
    placedByPlayer.set(building.playerId, (placedByPlayer.get(building.playerId) ?? 0) + 1)
  }
  return draft.sequence.map((playerId, slot) => {
    const remaining = placedByPlayer.get(playerId) ?? 0
    placedByPlayer.set(playerId, remaining - 1)
    return {
      playerId,
      placed: remaining > 0,
      mine: playerId === board.mePlayerId,
      current: slot === draft.turnIndex,
    }
  })
}
