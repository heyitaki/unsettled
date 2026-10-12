import type { DraftAnalysis } from '../engine/analysisProtocol'
import type { Board } from '../model/types'
import type { HighlightMark } from './store'

/** How many recommendations the analysis block lists, and so how many rest marks there are. */
export const LISTED_PICKS = 5

/**
 * The marks a board wears while nothing is selected (spec S5, DB1): every
 * listed recommendation's first pick at once, ranked, in the viewed colour.
 * Null when there is nothing to rank or nobody to rank it for, which leaves
 * the board bare.
 */
export function restingMarks(board: Board, analysis: DraftAnalysis, playerId = board.mePlayerId): HighlightMark[] | null {
  const player = board.players.find((candidate) => candidate.id === playerId)
  if (!player || analysis.status !== 'ready') return null
  return analysis.recommendations.slice(0, LISTED_PICKS).map((recommendation, index) => ({
    ref: recommendation.firstPick,
    color: player.color,
    label: String(index + 1),
  }))
}
