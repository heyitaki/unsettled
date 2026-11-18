import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { PLAYER_PALETTE } from '../src/model/types'

test('remembers a face across Settled screenshot imports', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('')
  const header = page.locator('.head-controls')
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  const players = page.locator('.player-panel')

  await header.locator('.head-title').click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/settled-5p-draft-start.png'))
  await expect(header.locator('.head-title')).toHaveText('Board 2', { timeout: 30_000 })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await header.getByRole('button', { name: 'Players', exact: true }).click()
  const first = players.locator('.roster-row').first()
  await first.getByRole('button', { name: 'Rename White', exact: true }).click()
  await first.getByRole('textbox').fill('alice')
  await first.getByRole('textbox').press('Enter')
  await expect(first.getByRole('button', { name: 'Rename alice', exact: true })).toBeVisible()
  const today = await page.evaluate(() => {
    const date = new Date()
    return `${date.getMonth() + 1}/${date.getDate()}`
  })
  await expect(header.locator('.head-title')).toHaveText(`${today} alice, Brown, Blue, Red, Green`)

  await header.locator('.head-title').click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/settled-5p-midgame-hand.png'))
  await expect(header.locator('.head-title')).toHaveText(`${today} Green, Blue, Brown, Red, alice`, { timeout: 30_000 })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await header.getByRole('button', { name: 'Players', exact: true }).click()
  const alice = players.locator('.roster-row').filter({ has: page.getByRole('button', { name: 'Rename alice', exact: true }) })
  await expect(alice).toHaveCount(1)
  const white = [1, 3, 5].map((start) => parseInt(PLAYER_PALETTE.white.slice(start, start + 2), 16)).join(', ')
  await expect(alice.locator('.swatch')).toHaveCSS('background-color', `rgb(${white})`)
  await expect(players.locator('.roster-row').last().getByRole('button', { name: 'Rename alice', exact: true })).toBeVisible()
})
