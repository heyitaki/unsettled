import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { draftOrder, placeBuilding } from '../src/model/board'
import { vertexAdjacentVertexIds } from '../src/model/coords'
import { newGame } from '../src/model/game'
import { boardGrid } from '../src/model/layouts'
import { appendLog, endTurn, recordBuild, recordRoll, setActivePlayer } from '../src/model/turn'
import type { Board, VertexId } from '../src/model/types'
import { WORKSPACE_KEY } from '../src/persistence/localStorage'

function recordedGame() {
  let board: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
  const taken = new Set<VertexId>()
  const spots = boardGrid(board.layout).vertexIds.filter((vertex) => {
    if (vertexAdjacentVertexIds(vertex).some((adjacent) => taken.has(adjacent))) return false
    taken.add(vertex)
    return true
  })
  draftOrder(board).forEach((id, index) => { board = placeBuilding(board, spots[index], id, 'settlement') })
  let game = setActivePlayer(newGame(board), board.players[0].id)
  for (let index = 0; index < 2; index += 1) {
    game = recordRoll(game, index === 0 ? 8 : 6, {})
    game = appendLog(recordBuild(game, 'city', spots[index], { free: true }), 'Built a city')
    game = endTurn(game)
  }
  return game
}

function historyTest() {
  test('views an older turn in the Ledger and board, then returns to now', async ({ page }) => {
    const game = recordedGame()
    await page.addInitScript(({ game, key }) => {
      localStorage.setItem(key, JSON.stringify({ tabs: [{ id: 'history', title: 'History test', game }] }))
    }, { game, key: WORKSPACE_KEY })
    await page.goto('')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const cities = page.locator('.board-canvas path[d="M-11.75,12.2 V-2.8 L0,-14.1 L11.75,-2.8 H17.6 V12.2 Z"]')
    await expect(cities).toHaveCount(2)
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    await expect(page.locator('.move-steps')).toHaveCount(0)
    await page.locator('.history-panel').getByRole('button', { name: `Turn 1: ${game.board.players[0].name}`, exact: true }).click()
    await expect(page.locator('.ledger-asof')).toHaveText('After turn 1')
    await expect(cities).toHaveCount(1)
    await expect(page.locator('.ledger-toggle').first()).toBeDisabled()
    await page.getByRole('button', { name: 'Back to now' }).click()
    await expect(page.locator('.ledger-asof')).toHaveCount(0)
    await expect(cities).toHaveCount(2)
    await expect(page.locator('.ledger-toggle').first()).toBeEnabled()
    await expect(page.locator('.history-panel')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Back to now' })).toHaveCount(0)
  })
}

test.describe('desktop history', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  historyTest()
})

test.describe('phone history', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  historyTest()
})
