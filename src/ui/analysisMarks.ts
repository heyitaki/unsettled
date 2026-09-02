import type { Recommendation } from '../engine/analyze'
import type { HighlightMark } from './store'

/**
 * A recommendation drawn on the board: my first pick as "1", its planned follow-up as "2", and
 * the setup road the first pick opens as "R", all in my colour, so hovering previews the pair I
 * would end the round holding and the direction I would expand in. The road is absent whenever
 * the recommendation has none. The phone sets the follow-up back (`fadedSecond`): it is where the
 * second settlement would go, not what the tap places (spec S5); the road rides the first pick and
 * is never faded.
 */
export const recommendationMarks = (
  recommendation: Recommendation,
  color: string,
  fadedSecond = false,
): HighlightMark[] => [
  { ref: recommendation.firstPick, color, label: '1' },
  ...recommendation.plannedSecond.slice(0, 1).map((ref) => ({ ref, color, label: '2', faded: fadedSecond })),
  ...(recommendation.firstRoad === null
    ? []
    : [{ ref: recommendation.firstRoad, color, label: 'R' }]),
]
