import { resolve } from 'node:path'
import { expect, test, type Route } from '@playwright/test'
import { LISTED_PICKS } from '../../src/ui/restMarks'

test('reloads offline and imports a board', async ({ page, context }) => {
  await page.goto('')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This board is empty' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.getByRole('button', { name: 'Randomize', exact: true }).click()
  await page.locator('.tools-panel').getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('.analysis-row')).toHaveCount(LISTED_PICKS)
  await page.locator('.site-header .head-title').click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  await dialog.locator('input[type=file]').setInputFiles(resolve('fixtures/board-endgame-pieces.png'))
  await expect(page.locator('.site-header .head-title')).toHaveText('Board 1')
  await dialog.getByRole('button', { name: 'Done' }).click()
  // The screenshot shows no turn order, so the import asks for it first.
  await page.locator('.import-review-panel').getByRole('button', { name: 'Skip', exact: true }).click()
  // The fixture is a game past its draft: the move adviser's wasm engine must answer from the precache.
  await expect(page.getByRole('heading', { name: 'Best moves' })).toBeVisible()
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await page.getByRole('group', { name: 'Dice total' }).getByRole('button', { name: '2', exact: true }).click()
  await expect(page.locator('.best-moves-panel .analysis-rank').first()).toBeVisible()
})

test('keeps import warnings open until Done and allows editing afterwards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('')
  await page.locator('.site-header .head-title').click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  await dialog.locator('input[type=file]').setInputFiles(resolve('fixtures/board-endgame-pieces.png'))
  await expect(page.locator('.site-header .head-title')).toHaveText('Board 2')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Roster was synthesized from detected pieces')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).not.toBeVisible()
  await page.locator('.head-title').click()
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'This board is empty' })).toBeVisible()
})

test('allows board switching while the analysis worker is still loading', async ({ page, context }) => {
  const held: Route[] = []
  await context.route(/analysis\.worker.*\.js/, (route) => { held.push(route) })
  try {
    await page.goto('')
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Edit the board' }).click()
    await page.getByRole('button', { name: 'Randomize', exact: true }).click()
    await page.locator('.tools-panel').getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Analyzing placements')
    await page.locator('.head-title').click()
    await page.getByRole('button', { name: 'New board', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'This board is empty' })).toBeVisible()
  } finally {
    for (const route of held) await route.abort().catch(() => {})
  }
})
