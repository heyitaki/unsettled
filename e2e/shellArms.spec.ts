import { expect, test, type Page } from '@playwright/test'
import { LISTED_PICKS } from '../src/ui/restMarks'
import { seedSavedMaps, seedUnclaimedRoster, UNCLAIMED_ROSTER } from './seed'

/**
 * The `Workspace` tree, which every viewport wider than 760px gets (spec B8),
 * a landscape phone included; anything narrower mounts `PhoneShell` whatever
 * its orientation or pointer.
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

/** The board actions live in the tools panel's dots menu, as in the phone header (spec D3). */
async function randomize(page: Page) {
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Randomize board' }).click()
}

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
    await expect(page.locator('.mobile-nav')).toHaveCount(0)

    const maps = page.locator('.maps-panel')
    const rows = maps.locator('.board-list .list-row')
    await expect(maps).toBeVisible()
    // Import is the panel's first action, ahead of the one list (spec D1).
    await expect(maps.locator('.panel-heading + .hero-import')).toHaveText('Import screenshot')
    await expect(maps.locator('.group-label')).toContainText('Boards (1)')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveClass(/\bcurrent\b/)
    await expect(rows.first().locator('.list-row-name')).toHaveText('Board 1')
    await expect(rows.first().getByRole('button', { name: 'Delete Board 1' })).toBeVisible()
    // A blank board has nothing saved, so it carries no timestamp.
    await expect(rows.first()).toBeVisible()
    await expect(rows.first().locator('.list-row-meta')).toHaveCount(0)
    await expect(maps.getByRole('button', { name: 'New board' })).toBeVisible()
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

    // An edit is all it takes to reach the library: there is no save button,
    // and the saved board is the same row, now stamped, not a second list.
    await randomize(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.list-row-meta')).toHaveText('just now')

    await rows.first().getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = maps.locator('.list-row-rename')
    await expect(field).toBeFocused()
    await field.fill('Harbour')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    // The rename reached the map and the board alike: still one row.
    await expect(rows.locator('.list-row-name')).toHaveText(['Harbour'])

    // Deleting a board takes its map and its row in one gesture, with nothing
    // to ask about. The blank new board lists ahead of the saved one.
    await maps.getByRole('button', { name: 'New board' }).click()
    await expect(rows.locator('.list-row-name')).toHaveText(['Board 1', 'Harbour'])
    await page.getByRole('button', { name: 'Delete Harbour' }).click()
    await expect(rows).toHaveCount(1)
    // The new board took the name the rename freed up.
    await expect(rows.first().locator('.list-row-name')).toHaveText('Board 1')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    expect(nativeDialogs).toBe(0)
  })

  test('draws the draft ribbon over a board wearing the resting marks, under a bare caption', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('footer')).toHaveCount(0)
    await randomize(page)

    // Two picks per player, the first one up (spec D4).
    const players = await page.locator('.player-list .roster-row').count()
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
    await expect(slots.first()).toHaveClass(/\bselected\b/)
    await expect(marks).toHaveCount(1)

    // Clicking the same slot again drops the mark back to the resting ones.
    await slots.first().click()
    await expect(slots.first()).not.toHaveClass(/\bselected\b/)
    await expect(marks).toHaveCount(LISTED_PICKS)

    // A card selected in Best picks owns the board's marks, so the ribbon's
    // outline goes with them; a hover over a card must not take them (spec DB2).
    await slots.first().click()
    await expect(slots.first()).toHaveClass(/\bselected\b/)
    await page.locator('.analysis-row').first().hover()
    await expect(slots.first()).toHaveClass(/\bselected\b/)
    await expect(marks).toHaveCount(1)
    await page.locator('.analysis-row').first().locator('.analysis-row-select').click()
    await expect(slots.first()).not.toHaveClass(/\bselected\b/)
    await expect(marks).toHaveCount(2)
  })

  test('the tool heading is a dots menu like the phone header, and the labels carry the counts the caption lost', async ({ page }) => {
    await page.goto('')
    const heading = page.locator('.tools-panel .panel-heading')
    await expect(heading.getByRole('button')).toHaveCount(1)
    await heading.getByRole('button', { name: 'Board options' }).click()
    const menu = page.getByRole('menu', { name: 'Board options' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Undo', 'Redo', 'Randomize board', 'Clear board'])
    await expect(menu.getByRole('menuitem', { name: 'Undo' })).toBeDisabled()
    // Clearing the board reads as destructive, as it does in the phone's menu (spec D3).
    await expect(menu.getByRole('menuitem', { name: 'Clear board' })).toHaveClass(/\bdanger\b/)
    // A viewport capture, not a full-page one: the full-page resize closes the menu.
    await page.screenshot({ path: 'test-results/phone/desktop-tools-menu.png' })
    await menu.getByRole('menuitem', { name: 'Randomize board' }).click()
    await expect(menu).toHaveCount(0)

    const labels = page.locator('.tools-panel .tool-label')
    const terrain = labels.filter({ hasText: 'Terrain' }).locator('.tool-count')
    await expect(terrain).toHaveText('19/19')
    await expect(labels.filter({ hasText: 'Structures' }).locator('.tool-count')).toHaveText('0 pieces')
    await snap(page, 'desktop-tools')

    // The chords are gone, so the menu's undo and redo are the only way back (spec D3).
    await heading.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Undo' }).click()
    await expect(terrain).toHaveText('0/19')
    await heading.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Redo' }).click()
    await expect(terrain).toHaveText('19/19')
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
    await expect(popup.getByRole('option')).toHaveCount(2)
    await expect(popup.locator('.menu-tick')).toHaveCount(2)
    const others = popup.locator('button:not(.active) .menu-tick')
    await expect(others).toHaveCount(1)
    await expect(others).toBeHidden()
    await page.keyboard.press('Escape')

    // The dots menu is the phone's sheet, tail and all (spec D6 menus).
    await page.getByRole('button', { name: 'Import and export files' }).click()
    const sheet = page.getByRole('menu', { name: 'Import and export files' })
    await expect(sheet).toHaveClass(/\bsheet-menu\b/)
    await expect(sheet.locator('.menu-tail')).toBeVisible()
    await expect(sheet.getByRole('menuitem').first().locator('.menu-icon')).toBeVisible()
    await snap(page, 'desktop-menus', false)
  })

  test('an empty board says so and offers nothing: the import and the tools are already in the left rail', async ({ page }) => {
    await page.goto('')
    const panel = page.locator('.analysis-panel')
    await expect(panel.locator('.eyebrow')).toHaveText('Nothing to rank yet')
    await expect(panel.locator('h2')).toHaveText('This board is empty')
    await expect(panel.locator('.hint')).toBeVisible()
    // Both ways in are on screen already, so the phone's two buttons stay on the phone (spec D4).
    await expect(panel.getByRole('button')).toHaveCount(0)
    await snap(page, 'desktop-empty-picks')
  })

  test('a card is claimed, selected and placed from, and hover never overrules a selection', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.analysis-panel')
    await expect(panel.locator('h2')).toHaveText('This board is empty')
    await randomize(page)
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
    // resizes the viewport, and the draft ribbon sliding under a live pointer
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
    await expect(structures).toHaveText('1 piece')
    await expect(panel.locator('.analysis-row.current')).toHaveCount(0)
    await snap(page, 'desktop-placed')
  })

  test('the cards are the phone cards: claimed rank circle, plain survival, flat chips', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await randomize(page)
    const panel = page.locator('.analysis-panel')
    const claim = panel.locator('.claim-row button').first()
    const mine = await claim.locator('.swatch').evaluate((el) => getComputedStyle(el).backgroundColor)
    await claim.click()
    await page.mouse.move(0, 0)

    // The circle wears the claimed colour inside an ink ring, not the accent disc (spec D4).
    const rank = panel.locator('.analysis-rank').first()
    await expect(rank).toHaveCSS('background-color', mine)
    await expect(rank).not.toHaveCSS('border-top-width', '0px')

    // The list is collapsed: a row is its pick line until it is selected, and
    // the factors open with it as flat tinted chips, not the bordered pills.
    await expect(panel.locator('.analysis-factors')).toHaveCount(0)
    await panel.locator('.analysis-row-select').first().click()
    await expect(panel.locator('.analysis-factors')).toHaveCount(1)
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

  test('the roster claims on the row, brushes on the swatch and renames on the name', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.player-panel')
    const rows = panel.locator('.roster-row')
    await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)
    await expect(panel.locator('.roster-row.me')).toHaveCount(0)
    // The heading's + moved to the dashed row under the roster (spec D5).
    await expect(panel.locator('.panel-heading button')).toHaveCount(0)
    await randomize(page)

    await rows.nth(1).click()
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(rows.nth(1).locator('.you-chip')).toBeVisible()
    await expect(rows.nth(0).locator('.you-chip')).toBeHidden()
    await expect(page.locator('.analysis-context .menu-trigger strong')).toHaveText('Blue')

    // The swatch sets the brush and leaves the claim where it is (spec DB3).
    const swatch = rows.nth(2).locator('.swatch')
    await swatch.click()
    await expect(swatch).toHaveAttribute('aria-pressed', 'true')
    const steppers = panel.locator('.player-steppers')
    await expect(steppers).toHaveCount(1)
    const brushed = await steppers.evaluate((el) =>
      el.previousElementSibling?.querySelector('.list-row-name')?.textContent)
    expect(brushed).toBe('Orange')
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(rows.nth(2)).not.toHaveClass(/\bme\b/)
    await snap(page, 'desktop-roster')

    // The grip only reorders: a click on it must not claim the row behind it.
    await rows.nth(2).locator('.roster-grip').click()
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(rows.nth(2)).not.toHaveClass(/\bme\b/)

    // The name is the rename target; the rest of the row is still the claim (spec DB4).
    await rows.nth(0).getByRole('button', { name: 'Rename Red', exact: true }).click()
    const field = panel.locator('.list-row-rename')
    await expect(field).toBeFocused()
    await field.fill('Mara')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rows.nth(0).locator('.list-row-name')).toHaveText('Mara')
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(page.locator('.draft-ribbon-slot').first()).toHaveAttribute('title', /Mara/)

    // The dashed row is the only way to add, and it stops at six seats.
    const add = panel.getByRole('button', { name: 'Add player' })
    await add.click()
    await add.click()
    await expect(rows).toHaveCount(6)
    await expect(add).toBeDisabled()
  })

  test('claims from the keyboard, and the controls over the claim button still answer', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const rows = page.locator('.player-panel .roster-row')
    await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)

    // The claim is a real button, so it takes focus and Enter (spec D5).
    const claim = rows.nth(2).getByRole('button', { name: `Claim ${UNCLAIMED_ROSTER[2].name}` })
    await claim.focus()
    await page.keyboard.press('Enter')
    await expect(rows.nth(2)).toHaveClass(/\bme\b/)
    await expect(claim).toHaveAttribute('aria-pressed', 'true')
    await expect(rows.nth(0).getByRole('button', { name: `Claim ${UNCLAIMED_ROSTER[0].name}` }))
      .toHaveAttribute('aria-pressed', 'false')

    // That button covers the whole row, so everything drawn over it has to keep
    // its own hit area: the swatch and the VP click, the tally shows its title.
    const swatch = rows.nth(3).locator('.swatch')
    await swatch.click()
    await expect(swatch).toHaveAttribute('aria-pressed', 'true')
    await expect(rows.nth(2)).toHaveClass(/\bme\b/)
    const own = await rows.nth(2).evaluate((row) => [...row.querySelectorAll('.player-tally > span, .roster-vp')]
      .every((el) => {
        const box = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
      }))
    expect(own).toBe(true)
  })

  /* The right rail is at its 372px ceiling well before the three-column arm's
     widest layout, so no width may take pixels back off the name (spec D5). */
  test('never narrows the roster name as the window widens', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.player-list .roster-row')).not.toHaveCount(0)
    const cell = page.locator('.player-list .roster-row .list-row-main').first()
    let narrowest = 0
    for (const width of [1121, 1200, 1300, 1339, 1340, 1400, 1580]) {
      await page.setViewportSize({ width, height: 900 })
      const measured = await cell.evaluate((el) => el.getBoundingClientRect().width)
      expect(measured, `at ${width}px`).toBeGreaterThanOrEqual(narrowest)
      narrowest = measured
    }
  })

  test('the snake draft ribbon sits under the roster, and a grip drag reseats it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.player-panel')
    const ribbon = panel.locator('.draft-section .draft-ribbon')
    const slots = ribbon.locator('.draft-ribbon-slot')

    // The ribbon is the phone's, two picks per player, in the Players panel and nowhere else.
    await expect(slots).toHaveCount(UNCLAIMED_ROSTER.length * 2)
    await expect(ribbon.locator('.draft-ribbon-slot.now')).toHaveCount(1)
    await expect(page.locator('.center-column .draft-ribbon')).toHaveCount(0)
    await expect(panel.locator('.draft-section .group-label')).toContainText('pick 1 of 8')
    await snap(page, 'desktop-draft-ribbon')

    // Seat order is draft order, so a reorder repaints the ribbon.
    const rows = panel.locator('.roster-row')
    await rows.first().locator('.roster-grip').dragTo(rows.nth(2))
    await expect(rows.locator('.list-row-name')).toHaveText(['Blue', 'Orange', 'Red', 'White'])
    await expect(slots.first()).toHaveAttribute('title', /Blue/)
    await expect(slots.first()).toHaveCSS('background-color', 'rgb(48, 99, 186)')

    // The trash row only exists mid-drag, so the drag has to be driven by hand:
    // dragTo resolves its target before the drop zone the drag creates exists.
    await expect(panel.locator('.roster-trash')).toHaveCount(0)
    await rows.first().locator('.roster-grip').hover()
    await page.mouse.down()
    const second = (await rows.nth(1).boundingBox())!
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 8 })
    const trash = panel.locator('.roster-trash')
    await expect(trash).toBeVisible()
    await trash.hover()
    await page.mouse.up()
    await expect(rows.locator('.list-row-name')).toHaveText(['Orange', 'Red', 'White'])
    await expect(slots).toHaveCount(6)
    await expect(panel.locator('.roster-trash')).toHaveCount(0)
  })

  test('a drag held still until the rows settle still lands where it was aimed', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.player-panel')
    const rows = panel.locator('.roster-row')
    await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)

    const third = (await rows.nth(2).boundingBox())!
    const x = third.x + third.width / 2
    const y = third.y + third.height / 2
    await rows.first().locator('.roster-grip').hover()
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 8 })
    // The lifted row leaves its own slot for the rows easing into it, and lands
    // in the one it is aimed at: a slot down the list, not a slot's height.
    await expect.poll(() => rows.first().evaluate((el) =>
      new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeGreaterThan(third.height)
    // One more pointer event now that every row has settled, which is what a
    // real drag supplies on its own (Chromium re-fires dragover on a still
    // pointer; the driver's drag interception only fires one per move). The
    // third row is no longer under the pointer, so the aim has to come from the
    // list and the layout the drag started with, or the drop is refused.
    await page.mouse.move(x, y + 1)
    await page.mouse.up()
    await expect(rows.locator('.list-row-name')).toHaveText(['Blue', 'Orange', 'Red', 'White'])
  })

  test('a library of maps scrolls inside the rail instead of pushing the tools off the page', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.maps-panel')).toBeVisible()
    await seedSavedMaps(page, 25)
    const saved = page.locator('.board-list')
    // The seeded maps, plus the blank board the document opened with.
    await expect(saved.locator('.list-row')).toHaveCount(26)

    // The list is bounded, so it scrolls inside the panel and wears the mask
    // over the rows it cuts off (spec D1).
    const list = await saved.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    expect(list.scroll).toBeGreaterThan(list.client)
    await expect(saved).toHaveClass(/fade-bottom/)

    // So the tools below it stay on screen however long the library grows.
    const viewport = page.viewportSize()!
    const toolsTop = await page.locator('.tools-panel')
      .evaluate((el) => el.getBoundingClientRect().top)
    expect(toolsTop).toBeLessThan(viewport.height)
  })

  /* The narrowest three-column width, where every workspace track sits on its
     floor and the roster row has the least to give. The name shares the row
     with a grip, a swatch, the YOU column, the tally and the VP, and it is the
     only cell that flexes, so this is where it gets squeezed out. */
  test.describe('at the narrowest three-column width', () => {
    test.use({ viewport: { width: 1121, height: 900 } })

    test('leaves the roster name a cell of its own instead of running it under the YOU chip', async ({ page }) => {
      await page.goto('')
      await seedUnclaimedRoster(page)
      const rows = page.locator('.player-list .roster-row')
      await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)
      // One claimed row, so the chip is measured where it is actually drawn.
      await rows.first().click()
      await expect(rows.first()).toHaveClass(/\bme\b/)

      // Both views, since the resources view carries a sixth tally column.
      for (const view of ['Pieces', 'Resources']) {
        await page.locator('.tally-bar .menu-trigger').click()
        await page.getByRole('option', { name: view }).click()
        const boxes = await rows.evaluateAll((elements) => elements.map((row) => ({
          cell: row.querySelector('.list-row-main')!.getBoundingClientRect().width,
          nameRight: row.querySelector('.list-row-name')!.getBoundingClientRect().right,
          chipLeft: row.querySelector('.you-chip')!.getBoundingClientRect().left,
        })))
        expect(boxes.length).toBeGreaterThan(1)
        for (const box of boxes) {
          expect(box.cell).toBeGreaterThan(0)
          expect(box.nameRight).toBeLessThanOrEqual(box.chipLeft)
        }
      }
      await snap(page, 'desktop-narrow')
    })
  })
})

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('gets the workspace, with no tab nav and no phone shell', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.workspace')).toBeVisible()
    await expect(page.locator('.mobile-nav')).toHaveCount(0)
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.board-tabs')).toHaveCount(0)
    await expect(page.locator('.maps-panel')).toBeVisible()
    // The ribbon lives in the Players panel here too, never over the board (spec DB6).
    await expect(page.locator('.center-column .draft-ribbon')).toHaveCount(0)
    await expect(page.locator('.player-panel .draft-ribbon')).toHaveCount(1)
    await expect(page.locator('footer')).toHaveCount(0)
    await snap(page, 'landscape')
  })

  test('rotating to portrait mounts the phone shell and rotating back restores the workspace', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.workspace')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.phone-shell')).toBeVisible()
    await expect(page.locator('.workspace')).toHaveCount(0)
    await snap(page, 'rotated-portrait')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('.phone-shell')).toHaveCount(0)
    await expect(page.locator('.workspace')).toBeVisible()
  })
})

/* The two-column arm, where the right rail wraps under the board. The board
   is sticky on the three-column arm, and Chromium bounds a sticky grid item by
   the grid rather than its row, so a pinned board would slide over the rail. */
test.describe('two-column desktop window', () => {
  test.use({ viewport: { width: 1000, height: 700 } })

  test('scrolls the board away rather than over the players panel', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.workspace')).toBeVisible()
    const board = page.locator('.center-column')
    const rail = page.locator('.right-rail')
    const railTop = await rail.evaluate((el) => el.getBoundingClientRect().top)
    const boardBottom = await board.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(boardBottom).toBeLessThanOrEqual(railTop)
    await rail.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    const scrolled = await board.evaluate((el) => el.getBoundingClientRect().bottom)
    const railScrolled = await rail.evaluate((el) => el.getBoundingClientRect().top)
    expect(scrolled).toBeLessThanOrEqual(railScrolled)
    await snap(page, 'desktop-two-column')
  })
})

/* A desktop window narrower than the phone arm but wider than it is tall: the
   old shared arm stacked the workspace behind a bottom tab bar here. Width
   alone picks the tree now. */
test.describe('narrow landscape desktop window', () => {
  test.use({ viewport: { width: 700, height: 640 } })

  test('mounts the phone shell and never a tab nav', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.phone-shell')).toBeVisible()
    await expect(page.locator('.workspace')).toHaveCount(0)
    await expect(page.locator('.mobile-nav')).toHaveCount(0)
    await expect(page.locator('[role="tablist"]')).toHaveCount(0)
    await snap(page, 'desktop-narrow-landscape')
  })
})
