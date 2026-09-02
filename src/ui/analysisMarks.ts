import type { Recommendation } from '../engine/analyze'
import type { HighlightMark } from './store'

/**
 * A recommendation drawn on the board: my first pick and its planned follow-up as numbered
 * circles, and the setup road the first pick opens as a stub of road along that edge, all in my
 * colour, so hovering previews the pair I would end the round holding and the direction I would
 * expand in. The road is absent whenever the recommendation has none. The phone sets the
 * follow-up back (`fadedSecond`): it is where the second settlement would go, not what the tap
 * places (spec S5); the road rides the first pick and is never faded.
 *
 * Every mark carries a label, but only the vertex ones show it: `BoardCanvas` draws the road as a
 * bare stroke, because a stub short enough to clear both endpoints has no room for a glyph.
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
    : [{ ref: recommendation.firstRoad, color, label: 'R', kind: 'road' as const }]),
]
