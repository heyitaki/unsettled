import { expect, test, type Page } from '@playwright/test'
import { LISTED_PICKS } from '../src/ui/restMarks'

/**
 * The two arms that must render as they did before the phone shell existed
 * (spec M15): the desktop workspace and the landscape phone. Both keep the
 * `Workspace` tree; only a portrait phone mounts `PhoneShell`.
 */

/**
 * A capture for the human review after the run, beside the phone shots.
 * `animations: 'disabled'` runs any open/fade to its end first, so a menu is
 * never caught half faded in. A full page unless the shot is of an open
 * `ContextMenu`: Chromium captures beyond the viewport by resizing it, and the
 * menu closes on resize.
 */
const snap = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: `test-results/phone/${name}.png`, fullPage, animations: 'disabled' })

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

  test('draws the draft ribbon over a board wearing the resting marks, under a bare caption', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('footer')).toHaveCount(0)
    await page.getByRole('button', { name: 'Randomize' }).click()

    // Two picks per player, the first one up (spec D4).
    const players = await page.locator('.player-list .player-card').count()
    const slots = page.locator('.draft-ribbon .draft-ribbon-slot')
    await expect(slots).toHaveCount(players * 2)
    await expect(slots.first()).toHaveClass(/\bnow\b/)

    // The board rests on the ranked picks, the lower ranks faded (spec D4).
    const marks = page.locator('.vertex-highlight')
    await expect(marks).toHaveCount(LISTED_PICKS)
    await expect(marks.nth(3)).toHaveClass(/\bfaded\b/)
    await expect(marks.nth(4)).toHaveClass(/\bfaded\b/)

    // The counts moved to the tool labels, so the caption is the layout alone.
    const caption = await page.locator('.board-status').innerText()
    expect(caption).not.toMatch(/terrain|pieces/)
    await snap(page, 'desktop-ribbon')

    // Nothing is hovered, so the slot's own mark is all the board carries.
    await slots.first().click()
    await expect(marks).toHaveCount(1)
  })

  test('dropdowns are the phone sheet: a chevron trigger and a tick on the current option', async ({ page }) => {
    await page.goto('')
    const trigger = page.getByRole('button', { name: 'Board layout' })
    await expect(trigger.locator('svg')).toHaveCount(1)
    await expect(trigger).not.toContainText('▾')

    await trigger.click()
    const popup = page.getByRole('listbox', { name: 'Board layout' })
    const active = popup.locator('button.active')
    await expect(active).toHaveCount(1)
    await expect(active.locator('.menu-tick')).toBeVisible()
    // Laid out on every option so the labels line up, painted on the current one only.
    await expect(popup.locator('.menu-tick')).toHaveCount(await popup.getByRole('option').count())
    await expect(popup.locator('button:not(.active) .menu-tick').first()).toBeHidden()
    await page.keyboard.press('Escape')

    // The dots menu is the phone's sheet, tail and all (spec D6 menus).
    await page.getByRole('button', { name: 'Import and export files' }).click()
    const sheet = page.getByRole('menu', { name: 'Import and export files' })
    await expect(sheet).toHaveClass(/\bsheet-menu\b/)
    await expect(sheet.locator('.menu-tail')).toBeVisible()
    await expect(sheet.getByRole('menuitem').first().locator('.menu-icon')).toBeVisible()
    await snap(page, 'desktop-menus', false)
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
    // The ribbon needs a row this arm has no height for (spec D4).
    await expect(page.locator('.draft-ribbon')).toBeHidden()
    await expect(page.locator('footer')).toHaveCount(0)
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
