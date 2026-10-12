import { expect, test } from '@playwright/test'
import { placeRoad } from '../src/model/board'
import { edgeEndpointVertexIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
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
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1100 } })
  suite()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  suite()
})
