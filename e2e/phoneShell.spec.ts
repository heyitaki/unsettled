import { expect, test, type Page } from '@playwright/test'

/**
 * The portrait-phone shell, in the one emulation that makes both
 * `(max-width: 760px) and (orientation: portrait)` and `(pointer: coarse)`
 * match in the installed Chromium. Never spread a `devices[...]` preset here:
 * the iPhone ones select WebKit, which is not installed.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })

/** A full-page capture for the human review after the run. */
const snap = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/phone/${name}.png`, fullPage: true })

async function open(page: Page) {
  await page.goto('')
  await expect(page.locator('.phone-shell')).toBeVisible()
}

test('the header names the active board and nothing of the desktop chrome mounts', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Board 1' })).toBeVisible()
  await expect(page.locator('.phone-title')).toHaveText('Board 1')
  for (const selector of ['.mobile-nav', '.board-tabs', '.site-header', 'footer']) {
    await expect(page.locator(selector)).toHaveCount(0)
  }
  await snap(page, 'header')
})

test('the dots menu holds undo, redo and the board actions', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Board options' }).click()
  const menu = page.getByRole('menu', { name: 'Board options' })
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Undo',
    'Redo',
    'Randomize board',
    'Export JSON',
    'Clear board',
  ])
  await expect(menu.getByRole('menuitem', { name: 'Undo' })).toBeDisabled()
  await snap(page, 'dots-menu')
})

test('the window is the only scroller and nothing overflows sideways', async ({ page }) => {
  await open(page)
  const nested = await page.locator('.phone-page').evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const overflow = getComputedStyle(el).overflowY
        return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight
      })
      .map((el) => el.className))
  expect(nested).toEqual([])
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBe(390)
  await snap(page, 'page')
})
