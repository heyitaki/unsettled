import { expect, test } from '@playwright/test'
import { placeRoad, setupGrants } from '../src/model/board'
import { edgeEndpointVertexIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
import { RESOURCES } from '../src/model/types'
import { finishedDraft } from '../src/ui/__tests__/finishedDraft'
import { seedBoard } from './seed'

function suite() {
  test('recaps the finished draft, starts play, and restores the recap on undo', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('')
    let { board } = finishedDraft(1)
    const grid = boardGrid(board.layout)
    for (const { vertexId, playerId } of board.buildings) {
      const edge = grid.edgeIds.find((id) => edgeEndpointVertexIds(id).includes(vertexId)
        && !board.roads.some((road) => road.edgeId === id))!
      board = placeRoad(board, edge, playerId)
    }
    await seedBoard(page, board)
    const recap = page.locator('.draft-recap-panel')
    await expect(recap.getByRole('heading', { name: 'Draft recap' })).toBeVisible()
    await expect(recap.getByRole('status')).toHaveCount(0, { timeout: 150_000 })
    await expect(recap.getByRole('alert')).toHaveCount(0)
    const percentages = recap.locator('.analysis-score')
    await expect(percentages).toHaveCount(4)
    const total = (await percentages.allTextContents()).reduce((sum, text) => sum + Number(text.replace('%', '')), 0)
    expect(total).toBeGreaterThanOrEqual(98)
    expect(total).toBeLessThanOrEqual(102)
    await recap.getByRole('button', { name: 'Start game' }).click()
    const moves = page.locator('.best-moves-panel')
    await expect(moves.getByRole('heading', { name: 'Best moves' })).toBeVisible()
    await expect(moves.getByRole('group', { name: 'Turn order' }).getByRole('button', { name: 'Turn 1: P1' }))
      .toHaveAttribute('aria-pressed', 'true')
    await moves.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(recap.getByRole('heading', { name: 'Draft recap' })).toBeVisible()
  })

  test('deals starting hands when the last settlement lands and keeps them into the game', async ({ page }) => {
    await page.goto('')
    // The claimed first player holds the last pick, so every rival's hand is already fixed by the seeded board.
    const { board } = finishedDraft(0)
    const grants = setupGrants(board)!
    await seedBoard(page, { ...board, buildings: board.buildings.slice(0, -1) })
    const recap = page.locator('.draft-recap-panel')
    const expectHands = async () => {
      for (const { id, name } of board.players.slice(1)) {
        const cards = RESOURCES.filter((resource) => grants[id][resource] > 0).map((resource) => `${grants[id][resource]} ${resource}`)
        expect(cards.length).toBeGreaterThan(0)
        const row = recap.getByRole('listitem', { name: new RegExp(`^${name}:`) })
        await expect.poll(() => row.locator('.hex-label').evaluateAll((labels) => labels.map((label) => label.getAttribute('aria-label'))))
          .toEqual(cards)
      }
    }
    const placeLast = async () => {
      await expect(page.getByRole('heading', { name: 'Best picks' })).toBeVisible()
      await page.locator('.analysis-row-select').first().click()
      await page.getByRole('button', { name: 'Place settlement' }).click()
      await expect(recap.getByRole('heading', { name: 'Draft recap' })).toBeVisible()
    }
    await placeLast()
    await expectHands()
    await recap.getByRole('button', { name: 'Start game' }).click()
    await expect(page.locator('.best-moves-panel').getByRole('heading', { name: 'Best moves' })).toBeVisible()
    await page.locator('.best-moves-panel').getByRole('button', { name: 'Undo', exact: true }).click()
    await expectHands()
    await recap.getByRole('button', { name: 'Undo', exact: true }).click()
    await placeLast()
    await expectHands()
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1100 } })
  suite()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  suite()
})
