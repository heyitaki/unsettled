import type { DraftAnalysis } from '../engine/analyze'
import { draftIsComplete } from '../engine/draft'
import type { Board, VertexId } from '../model/types'

/** One pick of the snake draft, as the draft strip and the phone ribbon draw it. */
export interface DraftSlot {
  playerId: string
  /** The pick has been taken; `vertex` is then the settlement standing for it. */
  placed: boolean
  /** Where the pick stands, or where the analysis expects it to land; undefined when nothing predicts it. */
  vertex: VertexId | undefined
  mine: boolean
  current: boolean
}

/**
 * Slot → placed-settlement mapping: the player's k-th building in board order.
 * Once the draft is complete count any tier, since starting settlements may
 * have been upgraded (placeBuilding upgrades in place, so the index holds).
 * Best-effort only — board order is insertion order for hand-placed boards,
 * but an imported board carries the parser's top-to-bottom spatial order, and
 * deleting then re-placing a building moves it to the end.
 */
export function draftSlots(board: Board, analysis: DraftAnalysis): DraftSlot[] {
  const { draft } = analysis
  const complete = draftIsComplete(board, draft)
  const placedByPlayer = new Map<string, VertexId[]>()
  for (const building of board.buildings) {
    if (!complete && building.tier !== 'settlement') continue
    const list = placedByPlayer.get(building.playerId)
    if (list) list.push(building.vertexId)
    else placedByPlayer.set(building.playerId, [building.vertexId])
  }
  const seenSlots = new Map<string, number>()
  const slotVertex = draft.sequence.map((playerId) => {
    const nth = seenSlots.get(playerId) ?? 0
    seenSlots.set(playerId, nth + 1)
    return placedByPlayer.get(playerId)?.[nth]
  })
  // Predicted spots for unplaced slots: opponents before my next pick come from
  // the modal rollout; my own picks from the top recommendation. Opponent picks
  // past my first pick have no prediction — hovering those shows nothing.
  const predicted = new Map<number, VertexId>()
  const firstMine = draft.myRemainingPickIndices[0]
  if (board.mePlayerId !== null && firstMine !== undefined) {
    const preSlots = draft.remainingPickIndices.filter((slot) =>
      slot >= (draft.turnIndex ?? firstMine) && slot < firstMine && draft.sequence[slot] !== board.mePlayerId)
    analysis.takenBeforeFirstPick.forEach((taken, index) => {
      const slot = preSlots[index]
      if (slot !== undefined) predicted.set(slot, taken.vertexId)
    })
    const top = analysis.recommendations[0]
    if (top) {
      predicted.set(firstMine, top.firstPick)
      const secondMine = draft.myRemainingPickIndices[1]
      if (secondMine !== undefined && top.plannedSecond[0] !== undefined) {
        predicted.set(secondMine, top.plannedSecond[0])
      }
    }
  }
  return draft.sequence.map((playerId, slot) => ({
    playerId,
    placed: slotVertex[slot] !== undefined,
    vertex: slotVertex[slot] ?? predicted.get(slot),
    mine: playerId === board.mePlayerId,
    current: slot === draft.turnIndex,
  }))
}
