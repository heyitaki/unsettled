import type { Recommendation } from '../engine/analysisProtocol'
import type { HighlightMark } from './store'

/**
 * A recommendation's numbered picks and faded full roads, all in the viewed player's colour.
 * The planned follow-up circle is faded because only the first pick is placed (spec S5).
 * Numbers follow that player's settlement count, matching placed settlements.
 * A road is absent whenever its pick opens nothing, and only circles display labels.
 */
export const recommendationMarks = (
  recommendation: Recommendation,
  color: string,
  pickNumber = 1,
): HighlightMark[] => [
  { ref: recommendation.firstPick, color, label: String(pickNumber), placeable: true },
  ...recommendation.plannedSecond.slice(0, 1).map((ref) => ({ ref, color, label: String(pickNumber + 1), faded: true })),
  ...(recommendation.firstRoad === null
    ? []
    : [{ ref: recommendation.firstRoad, color, label: 'R', kind: 'road' as const }]),
  ...(recommendation.secondRoad === null
    ? []
    : [{ ref: recommendation.secondRoad, color, label: 'R', kind: 'road' as const, faded: true }]),
]
