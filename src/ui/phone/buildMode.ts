import type { Game } from '../../model/game'
import type { TabState } from '../store'

/**
 * What the pencil captured on the way in (spec B1): the tab it opened on and
 * that tab's game at the time. Cancel restores the game; Done keeps whatever
 * the board holds now.
 */
export interface BuildSession {
  tabId: string
  game: Game
}

export const openBuildSession = (tab: TabState): BuildSession => ({ tabId: tab.id, game: tab.game })

/**
 * Build mode ends as Done when the board under the tools is replaced rather
 * than edited: the shell now shows another tab (a switch, or an import landing
 * in a new tab) or the layout was switched, which rebuilds the board.
 */
export function buildSessionEnded(session: BuildSession, tab: TabState): boolean {
  return tab.id !== session.tabId || tab.game.board.layout !== session.game.board.layout
}

/** The game Cancel restores, or null when nothing changed, so a no-op cancel owes no undo entry. */
export function cancelTarget(session: BuildSession, tab: TabState): Game | null {
  return tab.game === session.game ? null : session.game
}
