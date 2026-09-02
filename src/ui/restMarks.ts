import type { DraftAnalysis } from '../engine/analyze'
import type { Board } from '../model/types'
import type { HighlightMark } from './store'

/** How many of the resting marks stay solid; the ranks below them fade (spec S5). */
export const SOLID_RANKS = 3

/** How many recommendations the analysis block lists, and so how many rest marks there are. */
export const LISTED_PICKS = 5

/**
 * The marks a board wears while nothing is selected (spec S5, DB1): every
 * listed recommendation's first pick at once, ranked, in the claimed colour,
 * the lower ranks faded. Null when there is nothing to rank or nobody to rank
 * it for, which leaves the board bare.
 */
export function restingMarks(board: Board, analysis: DraftAnalysis): HighlightMark[] | null {
  const me = board.players.find((player) => player.id === board.mePlayerId)
  if (!me || analysis.status !== 'ready') return null
  return analysis.recommendations.slice(0, LISTED_PICKS).map((recommendation, index) => ({
    ref: recommendation.firstPick,
    color: me.color,
    label: String(index + 1),
    faded: index >= SOLID_RANKS,
  }))
}
