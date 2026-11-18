import { draftIsComplete, inferDraftState } from './draft'
import { computeStandings } from './stats'
import type { Game } from '../model/game'
import { currentTurnNumber } from '../model/history'

// Mirrors the engine's win_vp target.
const WIN_VP = 10

export type GameStage = 'not-started' | 'finished' | number

// Editing the board back into the draft after Start game keeps `turn`, so a recorded turn alone is not enough.
export const gameStarted = (game: Game): boolean =>
  game.turn !== undefined && draftIsComplete(game.board, inferDraftState(game.board))

export function gameStage(game: Game): GameStage {
  if (!gameStarted(game)) return 'not-started'
  if (computeStandings(game).some((player) => player.victoryPoints >= WIN_VP)) return 'finished'
  return currentTurnNumber(game)
}
