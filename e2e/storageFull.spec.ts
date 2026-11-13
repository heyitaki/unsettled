import { expect, test, type Page } from '@playwright/test'
import { createBoard } from '../src/model/board'
import { newGame } from '../src/model/game'
import { MAPS_KEY } from '../src/persistence/localStorage'
import { CLEANUP_AGE } from '../src/persistence/storageCleanup'

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  const now = Date.now()
  const game = newGame(createBoard('standard4'))
  const maps = [
    { id: 'oldest', name: 'Oldest game', age: 3 * CLEANUP_AGE },
    { id: 'old', name: 'Old game', age: 2 * CLEANUP_AGE },
    { id: 'recent', name: 'Recent game', age: 1000 },
  ].map(({ id, name, age }) => ({ id, name, game, createdAt: now - age, modifiedAt: now - age, openedAt: now - age }))
  await page.addInitScript(({ key, maps }) => {
    localStorage.setItem(key, JSON.stringify(maps))
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key && (JSON.parse(value) as unknown[]).length > 2) {
        throw new DOMException('Storage full', 'QuotaExceededError')
      }
      write.call(this, name, value)
    }
  }, { key: MAPS_KEY, maps })
  await page.goto('')
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.getByRole('button', { name: 'Randomize', exact: true }).click()
})

async function expectSaved(page: Page) {
  await expect(page.locator('.save-failure')).toHaveCount(0)
  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]') as {
      id: string; game: { board: { hexes: { tile: string | null }[] } }
    }[]
    return {
      count: saved.length,
      old: saved.some(({ id }) => id === 'oldest' || id === 'old'),
      recent: saved.some(({ id }) => id === 'recent'),
      edit: saved.some(({ id, game }) => id !== 'recent' && game.board.hexes.every(({ tile }) => tile !== null)),
    }
  }, MAPS_KEY)).toEqual({ count: 2, old: false, recent: true, edit: true })
}

test('cleaning up old games frees storage and saves the current edit', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Storage is full' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.locator('p')).toHaveText(/This browser has no room left, so your latest edits are not saved\. Clean up deletes the 2 games you haven't opened in 30 days\. You can also delete games yourself in Maps\./)
  await dialog.getByRole('button', { name: 'Clean up', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expectSaved(page)
})

test('Maps can clean up after declining the storage-full prompt', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Storage is full' })
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.head-title').click()
  const maps = page.locator('.maps-panel')
  await expect(maps).toBeVisible()
  const warning = maps.locator('.storage-warning')
  await expect(warning).toBeVisible()
  await expect(warning.locator('strong')).toHaveText('Storage is full')
  await expect(warning.locator('p')).toHaveText(/Your latest edits are not saved\. Clean up deletes the 2 games you haven't opened in 30 days\./)
  await warning.getByRole('button', { name: 'Clean up', exact: true }).click()
  await expect(warning).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expectSaved(page)
})
