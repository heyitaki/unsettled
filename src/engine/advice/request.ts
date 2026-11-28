import type { AdviceRequest } from './protocol'

/**
 * The engine rejects UI metadata; keep it in the saved game only. It also reads unseen cards as a
 * count, so narrowed ones go to it as plain unseen cards.
 */
export function engineRequest(request: AdviceRequest): AdviceRequest {
  const { history: _history, avatars: _avatars, ...game } = request.game
  if (Object.values(game.stats).some((stats) => stats.handUnknownAmong)) {
    game.stats = Object.fromEntries(Object.entries(game.stats).map(([id, { handUnknownAmong: _among, ...stats }]) => [id, stats]))
  }
  if (game.turn) {
    const { playerId, rolled, devPlayed, progressPlayed } = game.turn
    game.turn = { playerId, rolled, devPlayed, progressPlayed }
  }
  return { ...request, game }
}
