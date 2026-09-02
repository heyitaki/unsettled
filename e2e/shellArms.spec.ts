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

  test('switches boards from the Library panel, with no tab strip and no save UI', async ({ page }) => {
    let nativeDialogs = 0
    page.on('dialog', (dialog) => {
      nativeDialogs += 1
      void dialog.dismiss()
    })
    await page.goto('')
    await expect(page.locator('.board-tabs')).toHaveCount(0)
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.mobile-nav')).toBeHidden()

    const maps = page.locator('.maps-panel')
    const rows = maps.locator('.open-boards .list-row')
    const saved = maps.locator('.saved-maps .list-row')
    await expect(maps).toBeVisible()
    // Import is the panel's first action, ahead of both lists (spec D1).
    await expect(maps.locator('.panel-heading + .hero-import')).toHaveText('Import screenshot')
    await expect(maps.locator('.group-label').first()).toContainText('Open boards (1)')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveClass(/\bcurrent\b/)
    await expect(rows.first().locator('.list-row-name')).toHaveText('Board 1')
    await expect(rows.first().getByRole('button', { name: 'Close Board 1' })).toBeVisible()
    await expect(maps.getByRole('button', { name: 'New board' })).toBeVisible()
    await expect(maps.locator('.group-label').nth(1)).toContainText('Saved maps')
    await expect(saved).toHaveCount(0)
    await expect(maps.getByLabel('Map name')).toHaveCount(0)

    // The strip's right-click menu died with the strip; a row has no menu.
    await rows.first().click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)

    await maps.getByRole('button', { name: 'Import and export files' }).click()
    const menu = page.getByRole('menu', { name: 'Import and export files' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Import JSON', 'Export JSON'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await snap(page, 'desktop')

    // An edit is all it takes to reach the library: there is no save button.
    await page.getByRole('button', { name: 'Randomize' }).click()
    await expect(saved).toHaveCount(1)
    await expect(saved.first().locator('.list-row-name')).toHaveText('Board 1')

    await rows.first().getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = maps.locator('.list-row-rename')
    await expect(field).toBeFocused()
    await field.fill('Harbour')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rows.first().locator('.list-row-name')).toHaveText('Harbour')
    await expect(saved.first().locator('.list-row-name')).toHaveText('Harbour')

    // An edited board closes on the spot: it has already saved itself, so
    // there is nothing to ask about.
    await maps.getByRole('button', { name: 'New board' }).click()
    await expect(rows).toHaveCount(2)
    await page.getByRole('button', { name: 'Close Harbour' }).click()
    await expect(rows).toHaveCount(1)
    // The new board took the name the rename freed up.
    await expect(rows.first().locator('.list-row-name')).toHaveText('Board 1')
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
    await expect(page.locator('.board-tabs')).toHaveCount(0)
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
