import { expect, test, type Page } from '@playwright/test'
import { LISTED_PICKS } from '../src/ui/restMarks'
import { seedUnclaimedRoster, UNCLAIMED_ROSTER } from './seed'

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

  test('the tool heading is glyphs alone and the labels carry the counts the caption lost', async ({ page }) => {
    await page.goto('')
    const heading = page.locator('.tools-panel .panel-heading')
    for (const name of ['Randomize', 'Clear all', 'Undo', 'Redo']) {
      const button = heading.getByRole('button', { name })
      await expect(button.locator('svg')).toHaveCount(1)
      await expect(button).not.toContainText(/[\u2190\u2192]/)
    }
    // Clearing the board reads as destructive, as it does in the phone's menu (spec D3).
    await expect(heading.getByRole('button', { name: 'Clear all' })).toHaveClass(/\bdanger\b/)

    await heading.getByRole('button', { name: 'Randomize' }).click()
    const labels = page.locator('.tools-panel .tool-label')
    await expect(labels.filter({ hasText: 'Terrain' }).locator('.tool-count')).toHaveText('19/19')
    await expect(labels.filter({ hasText: 'Structures' }).locator('.tool-count')).toHaveText('0 pieces')
    await snap(page, 'desktop-tools')
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

  test('an empty board offers the import and keeps the build handoff to the phone', async ({ page }) => {
    await page.goto('')
    const panel = page.locator('.analysis-panel')
    await expect(panel.locator('.eyebrow')).toHaveText('Nothing to rank yet')
    await expect(panel.locator('h2')).toHaveText('This board is empty')
    await expect(panel.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
    // The tools are already on screen here, so there is nothing to hand off to (spec D4).
    await expect(panel.getByRole('button', { name: 'Build it by hand' })).toHaveCount(0)
    await snap(page, 'desktop-empty-picks')
  })

  test('a card is claimed, selected and placed from, and hover never overrules a selection', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.analysis-panel')
    await expect(panel.locator('h2')).toHaveText('This board is empty')
    await page.getByRole('button', { name: 'Randomize' }).click()
    await expect(panel.locator('h2')).toHaveText('Best picks')

    // Nobody is claimed, so the panel asks before it ranks (spec D4).
    await expect(panel.locator('.hint')).toHaveText('Pick your colour and the ranking starts.')
    await expect(panel.locator('.analysis-context')).toHaveCount(0)
    const swatches = panel.locator('.claim-row button')
    await expect(swatches).toHaveCount(UNCLAIMED_ROSTER.length)
    await snap(page, 'desktop-claim-row')
    await swatches.first().click()

    // The context line names the seat and its picks, and nothing about whose turn it is.
    const context = panel.locator('.analysis-context')
    await expect(context).toHaveText(/^You are/)
    await expect(context).toHaveText(/of 8$/)
    await expect(context).not.toContainText('turn')
    await expect(panel.locator('.panel-heading .turn-pill')).toHaveText('Your turn')

    const cards = panel.locator('.analysis-row')
    const marks = page.locator('.vertex-highlight')
    // The claim left the pointer over the list the claim row became, and a card
    // under the pointer previews; the board rests only once the pointer is off it.
    await page.mouse.move(0, 0)
    await expect(marks).toHaveCount(LISTED_PICKS)
    await cards.first().locator('.analysis-row-select').click()
    await expect(cards.first()).toHaveClass(/\bcurrent\b/)
    await expect(cards.first().getByRole('button', { name: 'Place settlement' })).toBeVisible()
    // The pinned pair: the pick taken, the planned follow-up set back.
    await expect(marks).toHaveCount(2)
    await expect(marks.first()).not.toHaveClass(/\bfaded\b/)
    await expect(marks.nth(1)).toHaveClass(/\bfaded\b/)

    // A hover is a preview, and a pinned card outranks it (spec DB2).
    await cards.nth(1).hover()
    await expect(marks).toHaveCount(2)
    await expect(cards.first()).toHaveClass(/\bcurrent\b/)

    // The pointer parks off the rails before the shot: a full-page capture
    // resizes the viewport, and the draft strip sliding under a live pointer
    // would repaint the board marks and drop the selection with them.
    await page.mouse.move(0, 0)
    await snap(page, 'desktop-selected-card')

    // Clearing drops back to the resting marks, and nothing was placed on the way.
    const structures = page.locator('.tools-panel .tool-label')
      .filter({ hasText: 'Structures' }).locator('.tool-count')
    await expect(structures).toHaveText('0 pieces')
    await cards.first().getByRole('button', { name: 'Clear' }).click()
    await page.mouse.move(0, 0)
    await expect(marks).toHaveCount(LISTED_PICKS)
    await expect(cards.first()).not.toHaveClass(/\bcurrent\b/)

    // Placing is the button's job alone, and it ends the selection with it.
    await cards.first().locator('.analysis-row-select').click()
    await cards.first().getByRole('button', { name: 'Place settlement' }).click()
    await expect(structures).toHaveText('1 pieces')
    await expect(panel.locator('.analysis-row.current')).toHaveCount(0)
    await snap(page, 'desktop-placed')
  })

  test('the cards are the phone cards: claimed rank circle, plain survival, flat chips', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await page.getByRole('button', { name: 'Randomize' }).click()
    const panel = page.locator('.analysis-panel')
    const claim = panel.locator('.claim-row button').first()
    const mine = await claim.locator('.swatch').evaluate((el) => getComputedStyle(el).backgroundColor)
    await claim.click()
    await page.mouse.move(0, 0)

    // The circle wears the claimed colour inside an ink ring, not the accent disc (spec D4).
    const rank = panel.locator('.analysis-rank').first()
    await expect(rank).toHaveCSS('background-color', mine)
    await expect(rank).not.toHaveCSS('border-top-width', '0px')

    // The factors are flat tinted chips, not the bordered pills.
    await expect(panel.locator('.analysis-factors span').first()).toHaveCSS('border-top-width', '0px')

    // Survival only renders on a spot the rollouts expect to be contested, and a
    // random board holds none more often than not, so the rule is read off a
    // probe put in a real card body and taken straight back out. The second read
    // resolves `--accent-dark` through the same element, so the assertion tracks
    // the token rather than a copy of its hex.
    const survival = await panel.locator('.analysis-row-body').first().evaluate((body) => {
      const probe = document.createElement('span')
      probe.className = 'analysis-availability'
      body.append(probe)
      const { borderRadius, color, backgroundColor } = getComputedStyle(probe)
      probe.style.color = 'var(--accent-dark)'
      const accentDark = getComputedStyle(probe).color
      probe.remove()
      return { borderRadius, color, backgroundColor, accentDark }
    })
    expect(survival.borderRadius).toBe('0px')
    expect(survival.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(survival.color).toBe(survival.accentDark)

    await snap(page, 'desktop-cards')
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
