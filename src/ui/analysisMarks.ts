import type { Recommendation } from '../engine/analyze'
import type { HighlightMark } from './store'

/**
 * A recommendation drawn on the board: my first pick and its planned follow-up as numbered
 * circles, and the setup road the first pick opens as a stub of road along that edge, all in my
 * colour, so selecting a card shows the pair I would end the round holding and the direction I
 * would expand in. The road is absent whenever the recommendation has none. The follow-up sits
 * back, faded: it is where the second settlement would go, not what the card places (spec S5);
 * the road rides the first pick and is never faded.
 *
 * Every mark carries a label, but only the vertex ones show it: `BoardCanvas` draws the road as a
 * bare stroke, because a stub short enough to clear both endpoints has no room for a glyph.
 */
export const recommendationMarks = (
  recommendation: Recommendation,
  color: string,
): HighlightMark[] => [
  { ref: recommendation.firstPick, color, label: '1' },
  ...recommendation.plannedSecond.slice(0, 1).map((ref) => ({ ref, color, label: '2', faded: true })),
  ...(recommendation.firstRoad === null
    ? []
    : [{ ref: recommendation.firstRoad, color, label: 'R', kind: 'road' as const }]),
]
