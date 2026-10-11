import { draftIsComplete, inferDraftState, type DraftState } from '../engine/draft'
import type { Board } from '../model/types'

export function viewedPlayerId(board: Board, viewedPick: number | null | undefined): string | null {
  return viewedPick == null ? board.mePlayerId : inferDraftState(board).sequence[viewedPick] ?? null
}

/** One pick of the snake draft, as the draft grid and the ribbon draw it. */
export interface DraftSlot {
  playerId: string
  placed: boolean
  mine: boolean
  current: boolean
  /** The pick Best picks is ranking, defaulting to the claimed player's next unplaced pick. */
  viewed: boolean
}

export function draftSlots(board: Board, draft: DraftState, viewedPick?: number | null): DraftSlot[] {
  const complete = draftIsComplete(board, draft)
  const placedByPlayer = new Map<string, number>()

  // Upgraded starting settlements still count once the draft is over.
  for (const building of board.buildings) {
    if (!complete && building.tier !== 'settlement') continue
    placedByPlayer.set(building.playerId, (placedByPlayer.get(building.playerId) ?? 0) + 1)
  }
  let viewing = false
  return draft.sequence.map((playerId, slot) => {
    const remaining = placedByPlayer.get(playerId) ?? 0
    placedByPlayer.set(playerId, remaining - 1)
    const placed = remaining > 0
    const mine = playerId === board.mePlayerId
    const viewed = viewedPick == null ? mine && !placed && !viewing : slot === viewedPick
    viewing ||= viewed
    return { playerId, placed, mine, current: slot === draft.turnIndex, viewed }
  })
}
