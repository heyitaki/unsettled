import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { addPlayer, createBoard } from '../src/model/board'
import { adjustCounter, newGame } from '../src/model/game'
import { MAPS_KEY, WORKSPACE_KEY } from '../src/persistence/localStorage'

async function downloadedBackup(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Backup was not downloaded')
  return readFile(path, 'utf8')
}

async function randomize(page: Page) {
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Randomize board' }).click()
}

test('screenshot import contains keyboard focus and Escape restores the opener', async ({ page }) => {
  await page.goto('')
  const opener = page.getByRole('button', { name: 'Import screenshot', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  const input = dialog.locator('input[type=file]')
  await expect(input).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('a whole-library backup restores into another browser without losing its boards', async ({ page, browser, baseURL }) => {
  await page.goto('')
  await randomize(page)
  await page.getByRole('button', { name: 'Import and export files' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Back up library' }).click()
  const contents = await downloadedBackup(await downloaded)
  const context = await browser.newContext({ baseURL })
  try {
    const restored = await context.newPage()
    await restored.goto('')
    await restored.getByRole('button', { name: 'Import and export files' }).click()
    const choosing = restored.waitForEvent('filechooser')
    await restored.getByRole('menuitem', { name: 'Restore library backup' }).click()
    await (await choosing).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) })
    await expect(restored.getByRole('status')).toHaveText(/Restored 1 board/)
    await expect(restored.locator('.maps-panel .list-row-meta')).toHaveCount(1)
    const saved = await restored.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), MAPS_KEY)
    expect(saved[0].game.board.hexes.every((hex: { tile: string | null }) => hex.tile !== null)).toBe(true)
  } finally { await context.close() }
})

test('failed saves stay actionable until Retry saves the current board', async ({ page }) => {
  await page.addInitScript(({ maps, workspace }) => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (sessionStorage.getItem('test:allow-saves') !== 'yes' && (key === maps || key === workspace)) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      write.call(this, key, value)
    }
  }, { maps: MAPS_KEY, workspace: WORKSPACE_KEY })
  await page.goto('')
  await randomize(page)
  const failure = page.locator('.save-failure')
  await expect(failure).toContainText('Could not save')
  const downloaded = page.waitForEvent('download')
  await failure.getByRole('button', { name: 'Export backup' }).click()
  const contents = JSON.parse(await downloadedBackup(await downloaded))
  expect(contents.maps[0].game.board.hexes.every((hex: { tile: string | null }) => hex.tile !== null)).toBe(true)
  await page.evaluate(() => sessionStorage.setItem('test:allow-saves', 'yes'))
  await failure.getByRole('button', { name: 'Retry saving' }).click()
  await expect(failure).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Best picks' })).toBeVisible()
})

test('award corrections survive undo, redo and reload', async ({ page }) => {
  const board = addPlayer(createBoard('standard4'), { id: 'blue', name: 'Blue', color: '#3063ba' })
  const game = adjustCounter(adjustCounter(newGame(board), 'aki', 'knights', 3), 'blue', 'knights', 3)
  await page.addInitScript(({ key, game }) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ tabs: [{ id: 'awards', title: 'Awards', game }] }))
    }
  }, { key: WORKSPACE_KEY, game })
  await page.goto('')
  await page.locator('.award-controls summary').click()
  const holder = page.getByRole('button', { name: /Largest army holder/ })
  await expect(holder).toContainText('Unknown')
  await holder.click()
  await page.getByRole('option', { name: 'Blue', exact: true }).click()
  await expect(holder).toContainText('Blue')
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(holder).toContainText('Unknown')
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
  await expect(holder).toContainText('Blue')
  await page.reload()
  await page.locator('.award-controls summary').click()
  await expect(holder).toContainText('Blue')
})
