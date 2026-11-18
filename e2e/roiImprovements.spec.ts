import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { adjustCounter } from '../src/model/game'
import { setActivePlayer } from '../src/model/turn'
import { MAPS_KEY, WORKSPACE_KEY } from '../src/persistence/localStorage'
import { finishedDraft } from '../src/ui/__tests__/finishedDraft'

async function downloadedBackup(download: Download) {
  const path = await download.path()
  if (!path) throw new Error('Backup was not downloaded')
  return readFile(path, 'utf8')
}

async function randomize(page: Page) {
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.getByRole('button', { name: 'Randomize', exact: true }).click()
  await page.locator('.tools-panel').getByRole('button', { name: 'Done', exact: true }).click()
}

test('screenshot import contains keyboard focus and Escape restores the opener', async ({ page }) => {
  await page.goto('')
  const opener = page.locator('.head-controls .head-title')
  await opener.click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
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
  await page.locator('.head-title').click()
  await page.getByRole('button', { name: 'Import and export files' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Back up library' }).click()
  const contents = await downloadedBackup(await downloaded)
  const context = await browser.newContext({ baseURL })
  try {
    const restored = await context.newPage()
    await restored.goto('')
    await restored.locator('.head-title').click()
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
  const draft = finishedDraft()
  const [first, second] = draft.board.players
  const game = setActivePlayer(adjustCounter(adjustCounter(draft, first.id, 'knights', 3), second.id, 'knights', 3), first.id)
  await page.addInitScript(({ key, game }) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ tabs: [{ id: 'awards', title: 'Awards', game }] }))
    }
  }, { key: WORKSPACE_KEY, game })
  await page.goto('')
  const ledger = page.locator('.ledger-panel')
  const tie = ledger.getByRole('group', { name: 'Largest army tie', exact: true })
  const holder = tie.getByRole('button', { name: second.name, exact: true })
  const record = page.locator('.best-moves-panel').filter({ has: page.getByRole('heading', { name: 'Record your turn', exact: true }) })
  const award = ledger.getByLabel('Largest army, +2 VP')
  await expect(tie).toContainText('Who got there first?')
  await holder.click()
  await expect(tie).toHaveCount(0)
  await expect(award).toHaveCount(1)
  await record.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(tie).toContainText('Who got there first?')
  await expect(award).toHaveCount(0)
  await record.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(tie).toHaveCount(0)
  await page.reload()
  await expect(award).toHaveCount(1)
  await expect(tie).toHaveCount(0)
})

test('tapping a port badge in build mode deletes the port', async ({ page }) => {
  await page.goto('')
  const badges = page.locator('.board-canvas .port-token')
  await expect(badges.first()).toBeVisible()
  const count = await badges.count()
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await badges.first().click()
  await expect(badges).toHaveCount(count - 1)
})
