import type { Recommendation } from '../engine/analysisProtocol'
import type { RowContest } from '../engine/contest'
import type { HighlightMark } from './store'

export function contestMarks(
  contested: RowContest['contested'],
  colorOf: (playerId: string) => string,
): HighlightMark[] {
  const seen = new Set<string>()
  return contested.filter(({ vertexId }) => {
    if (seen.has(vertexId)) return false
    seen.add(vertexId)
    return true
  }).map(({ vertexId, playerId }) => ({ ref: vertexId, color: colorOf(playerId), kind: 'ring' }))
}

/**
 * A recommendation drawn on the board: my first pick and its planned follow-up as numbered
 * circles, and the setup roads they open as stubs along their edges, all in my
 * colour, so selecting a card shows the pair I would end the round holding and the direction I
 * would expand in. A road is absent whenever its pick opens nothing. The follow-up and its road
 * sit back, faded: they show the planned second pick, not what the card places (spec S5). The numbers are the player's own settlement
 * count, so a row ranking their second settlement stamps `2`, matching the number that
 * settlement wears once placed.
 *
 * Every mark carries a label, but only the vertex ones show it: `BoardCanvas` draws the road as a
 * bare stroke, because a stub short enough to clear both endpoints has no room for a glyph.
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
