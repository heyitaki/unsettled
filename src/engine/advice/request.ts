import type { AdviceRequest } from './protocol'

/** The engine rejects UI metadata; keep it in the saved game only. */
export function engineRequest(request: AdviceRequest): AdviceRequest {
  const { history: _history, avatars: _avatars, specialBuild: _specialBuild, ...game } = request.game
  if (game.turn) {
    const { playerId, rolled, devPlayed, progressPlayed } = game.turn
    game.turn = { playerId, rolled, devPlayed, progressPlayed }
  }
  return { ...request, game }
}
