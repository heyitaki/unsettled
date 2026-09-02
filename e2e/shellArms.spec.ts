import { expect, test, type Page } from '@playwright/test'

/**
 * The two arms that must render as they did before the phone shell existed
 * (spec M15): the desktop workspace and the landscape phone. Both keep the
 * `Workspace` tree; only a portrait phone mounts `PhoneShell`.
 */

/** A capture for the human review after the run, beside the phone shots. */
const snap = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/phone/${name}.png`, fullPage: true })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('keeps the tab strip, has no phone shell, and no save UI is left anywhere', async ({ page }) => {
    let nativeDialogs = 0
    page.on('dialog', (dialog) => {
      nativeDialogs += 1
      void dialog.dismiss()
    })
    await page.goto('')
    await expect(page.locator('.board-tabs')).toBeVisible()
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.mobile-nav')).toBeHidden()

    await page.getByRole('tab', { name: 'Board 1' }).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    // Items print their chords beside the label, so match the label's start.
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Rename/,
      /^Duplicate/,
      /^Close/,
      /^Close others/,
      /^Close to the right$/,
    ])
    await expect(menu.getByRole('menuitem', { name: 'Save to library' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    const maps = page.locator('.maps-panel')
    await expect(maps).toBeVisible()
    await expect(maps.getByLabel('Map name')).toHaveCount(0)
    await expect(maps.locator('input')).toHaveCount(0)
    await snap(page, 'desktop')

    // An edited board closes on the spot: it has already saved itself, so
    // there is nothing to ask about.
    await page.getByRole('button', { name: 'Randomize' }).click()
    await page.getByRole('button', { name: 'Add board' }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.getByRole('button', { name: 'Close Board 1' }).click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.getByRole('tab', { name: 'Board 1' })).toHaveCount(0)
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    expect(nativeDialogs).toBe(0)
  })
})

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('keeps the four-tab nav and mounts no phone shell', async ({ page }) => {
    await page.goto('')
    const nav = page.locator('.mobile-nav')
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('tab')).toHaveText(['Board', 'Players', 'Picks', 'Library'])
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.board-tabs')).toBeHidden()
    await snap(page, 'landscape')
  })

  test('rotating to portrait mounts the phone shell and rotating back restores the nav', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.mobile-nav')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.phone-shell')).toBeVisible()
    await expect(page.locator('.mobile-nav')).toHaveCount(0)
    await snap(page, 'rotated-portrait')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.mobile-nav')).toBeVisible()
  })
})
