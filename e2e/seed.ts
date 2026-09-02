import type { Page } from '@playwright/test'

/** The roster `seedUnclaimedRoster` writes, in the order the claim row renders it. */
export const UNCLAIMED_ROSTER = [
  { id: 'p1', name: 'Red', color: '#c23f38' },
  { id: 'p2', name: 'Blue', color: '#3063ba' },
  { id: 'p3', name: 'Orange', color: '#e58331' },
  { id: 'p4', name: 'White', color: '#ffffff' },
]

/**
 * A fresh board boots with one claimed player, so the no-me state needs a
 * roster nobody has claimed. The store flushes its own workspace on pagehide,
 * so the seed runs at the start of the reloaded document, after that flush,
 * and edits only the roster fields of the stored tab. The caller waits for the
 * reloaded tree in its own vocabulary.
 */
export async function seedUnclaimedRoster(page: Page) {
  await page.addInitScript((players) => {
    const key = 'unsettled.workspace.v1'
    const raw = localStorage.getItem(key)
    if (raw === null) return
    const workspace = JSON.parse(raw)
    const board = workspace.tabs[0].game.board
    board.players = players
    board.mePlayerId = null
    workspace.tabs[0].game.stats = {}
    delete workspace.tabs[0].activePlayerId
    localStorage.setItem(key, JSON.stringify(workspace))
  }, UNCLAIMED_ROSTER)
  await page.reload()
}
