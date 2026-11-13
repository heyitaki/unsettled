import { expect, test } from '@playwright/test'
import { createBoard } from '../src/model/board'
import { newGame } from '../src/model/game'
import { MAPS_KEY } from '../src/persistence/localStorage'
import { CLEANUP_AGE } from '../src/persistence/storageCleanup'

test.use({ viewport: { width: 1440, height: 900 } })

test('deleting old games frees storage and saves the current edit', async ({ page }) => {
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
  const dialog = page.getByRole('dialog', { name: 'Storage is full' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: 'Oldest game', exact: true })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Old game', exact: true })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Recent game', exact: true })).not.toBeChecked()
  await dialog.getByRole('button', { name: /^Delete 2 games · \d+ KB$/ }).click()
  await expect(dialog).toHaveCount(0)
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
})
