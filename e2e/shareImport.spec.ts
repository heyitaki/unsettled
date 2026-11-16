import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WORKSPACE_KEY } from '../src/persistence/localStorage'
import { SHARE_EVENT } from '../src/ui/sharedImage'

const FIXTURE = 'settled-3p-pick-cards'
const IMPORT_TITLE = 'Board 2'

/** What the iOS app does with an image from the share sheet: a File on the share event. */
async function share(page: Page) {
  const base64 = readFileSync(resolve(`fixtures/${FIXTURE}.png`)).toString('base64')
  await page.evaluate(({ event, base64, name }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    window.dispatchEvent(new CustomEvent(event, { detail: new File([bytes], name, { type: 'image/png' }) }))
  }, { event: SHARE_EVENT, base64, name: `${FIXTURE}.png` })
}

/** Imported boards, once the workspace autosave has written them. */
const boards = (page: Page) => page.evaluate(({ key, name }) => {
  const workspace = JSON.parse(localStorage.getItem(key) ?? '{"tabs":[]}') as { tabs: { title: string }[] }
  return workspace.tabs.filter((tab) => tab.title === name).length
}, { key: WORKSPACE_KEY, name: IMPORT_TITLE })

test('a shared screenshot opens as a new board, and sharing it again updates that board', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('')
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  const title = page.locator('.site-header').getByRole('button', { name: IMPORT_TITLE, exact: true })

  await share(page)
  await expect(title).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => boards(page)).toBe(1)

  await share(page)
  await expect(dialog).toContainText(`You already have this board as "${IMPORT_TITLE}"`, { timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(title).toBeVisible()
  await expect.poll(() => boards(page)).toBe(1)
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })

  test('a share that lands while Maps is open leaves the board on screen', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.phone-shell')).toBeVisible()
    const screen = page.getByRole('dialog', { name: 'Maps' })
    await page.locator('.head-title').click()
    await expect(screen).toBeVisible()

    await share(page)
    await expect(page.locator('.head-title')).toHaveText(IMPORT_TITLE, { timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: 'Import screenshot' })).toHaveCount(0)
    await expect(screen).toHaveCount(0)
  })
})
