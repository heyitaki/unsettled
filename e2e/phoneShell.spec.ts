import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { seedUnclaimedRoster as seedRoster, UNCLAIMED_ROSTER } from './seed'

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

  // The history pair names the action and nothing else: no stack depth (spec D3).
  await menu.getByRole('menuitem', { name: 'Randomize board' }).click()
  await page.getByRole('button', { name: 'Board options' }).click()
  await expect(page.getByRole('menu', { name: 'Board options' })
    .getByRole('menuitem', { name: 'Undo' })).toHaveText('Undo')
})

test('the window is the only scroller and nothing overflows sideways', async ({ page }) => {
  await open(page)
  // Judged on the declared overflow, not on whether the content happens to
  // fit today: a nested scroller that fits a blank board still scrolls a full
  // one. A sideways tool row computes to `overflow-y: auto` as well, so only
  // those are held to their actual height.
  const nested = await page.locator('.phone-page').evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const { overflowX, overflowY } = getComputedStyle(el)
        const scrolls = (value: string) => value === 'auto' || value === 'scroll'
        if (!scrolls(overflowY)) return false
        return scrolls(overflowX) ? el.scrollHeight > el.clientHeight : true
      })
      .map((el) => el.className))
  expect(nested).toEqual([])
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBe(390)
  await snap(page, 'page')
})

test('the ribbon shows every pick and the board sits in a square sea', async ({ page }) => {
  await open(page)
  const players = await page.locator('.phone-dot').count()
  const slots = page.locator('.draft-ribbon-slot')
  await expect(slots).toHaveCount(players * 2)
  await expect(slots.first()).toHaveClass(/\bnow\b/)
  const frame = await page.locator('.board-canvas').boundingBox()
  expect(frame).not.toBeNull()
  expect(Math.abs(frame!.width - frame!.height)).toBeLessThanOrEqual(1)
  await snap(page, 'ribbon-board')
})

test('the six-player layout gets a taller frame under an unmoved ribbon and a bare caption', async ({ page }) => {
  await open(page)
  const ribbonTop = (await page.locator('.draft-ribbon').boundingBox())!.y
  await page.getByRole('button', { name: /Board layout/ }).click()
  await page.getByRole('option', { name: '5–6 player' }).click()
  await expect(page.locator('.board-status')).toContainText('5–6 player')
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  const frame = await page.locator('.board-canvas').boundingBox()
  expect(frame!.height).toBeGreaterThan(frame!.width)
  expect((await page.locator('.draft-ribbon').boundingBox())!.y).toBe(ribbonTop)
  const caption = await page.locator('.board-status').innerText()
  expect(caption).not.toMatch(/terrain|pieces/)
  await snap(page, 'six-player-frame')
})

/** The shared seed, plus the wait for the reloaded shell to show the new roster. */
async function seedUnclaimedRoster(page: Page) {
  await seedRoster(page)
  await expect(page.locator('.phone-dot')).toHaveCount(UNCLAIMED_ROSTER.length)
}

test('an empty board offers the two ways to fill it', async ({ page }) => {
  await open(page)
  const block = page.locator('.phone-analysis')
  await expect(block.locator('.eyebrow')).toHaveText('Nothing to rank yet')
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await expect(block.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
  const build = block.getByRole('button', { name: 'Build it by hand' })
  await expect(build).toBeVisible()
  const pencil = page.getByRole('button', { name: 'Edit the board' })
  await expect(pencil).toHaveAttribute('aria-pressed', 'false')
  await build.click()
  await expect(pencil).toHaveAttribute('aria-pressed', 'true')
  await pencil.click()
  await expect(pencil).toHaveAttribute('aria-pressed', 'false')
  await snap(page, 'empty-board')
  await block.getByRole('button', { name: 'Import screenshot' }).click()
  await expect(page.getByRole('dialog', { name: 'Import screenshot' })).toBeVisible()
})

test('an import with parse issues keeps its dialog over the new board, and closes for good', async ({ page }) => {
  await open(page)
  const block = page.locator('.phone-analysis')
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  await block.getByRole('button', { name: 'Import screenshot' }).click()
  // The robber hides a token on this fixture, so the parse lands with a
  // warning. The board fills, the empty state goes, and the dialog must
  // survive that to show the warning.
  await dialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/board-endgame-pieces.png'))
  await expect(page.locator('.phone-title')).toHaveText('board-endgame-pieces', { timeout: 30_000 })
  await expect(block.locator('h2')).toHaveText('Best picks')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.issue-list button.warning')).not.toHaveCount(0)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
  // Emptying the board again must not bring the dialog back on its own.
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Clear board' }).click()
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await expect(dialog).toHaveCount(0)
})

test('a filled board asks who you are, and a tapped swatch claims that seat', async ({ page }) => {
  await open(page)
  await seedUnclaimedRoster(page)
  const block = page.locator('.phone-analysis')
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Randomize board' }).click()
  await expect(block.locator('h2')).toHaveText('Best picks')
  await expect(block.locator('.analysis-context')).toHaveCount(0)
  const swatches = block.locator('.claim-row button')
  await expect(swatches).toHaveCount(4)
  await snap(page, 'claim-row')
  await swatches.first().click()
  await expect(block.locator('.analysis-context')).toHaveText(/^You are/)
  await expect(page.locator('.phone-dot').first()).toHaveClass(/\bme\b/)
  await expect(block.locator('.analysis-row').first()).toBeVisible()
  await snap(page, 'best-picks')
})

/**
 * A shorter portrait phone: at 844px tall a fresh board's page barely scrolls
 * past the reveal threshold, and the card heights vary with the random board,
 * so the scrolled-past case needs more page than viewport.
 */
test.describe('reveal on select', () => {
  test.use({ viewport: { width: 390, height: 700 } })

  test('the board marks every pick at rest and comes back into view when a card is tapped past it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    const block = page.locator('.phone-analysis')
    await expect(block.locator('.analysis-context')).toHaveText(/^You are/)
    const marks = page.locator('.vertex-highlight')
    await expect(marks).toHaveCount(5)
    await expect(page.locator('.vertex-highlight.faded')).toHaveCount(2)
    const myColor = await page.locator('.phone-dot.me').evaluate((dot) => getComputedStyle(dot).backgroundColor)
    await expect(marks.first()).toHaveCSS('fill', myColor)
    await snap(page, 'rest-marks')

    const cards = block.locator('.analysis-row-select')
    await expect(cards).toHaveCount(5)
    await page.evaluate(() => window.scrollBy(0, 2000))
    const scrolledBoard = (await page.locator('.board-canvas').boundingBox())!
    const header = (await page.locator('.phone-head').boundingBox())!
    expect(scrolledBoard.y + scrolledBoard.height).toBeLessThan(header.y + header.height + 120)
    await cards.last().click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(marks).toHaveCount(2)
    await expect(page.locator('.vertex-highlight.faded')).toHaveCount(1)
    await snap(page, 'selected-card')

    await page.evaluate(() => window.scrollTo(0, 60))
    const first = (await cards.first().boundingBox())!
    expect(first.y + first.height).toBeLessThan(700)
    await cards.first().click()
    await expect(block.locator('.analysis-row.current .analysis-rank')).toHaveText('1')
    expect(await page.evaluate(() => window.scrollY)).toBe(60)
  })
})

test.describe('build mode', () => {
  test('the pencil swaps in the tools without moving the board, a layout switch leaves as Done, and Cancel restores the board', async ({ page }) => {
    await open(page)
    const boardTop = (await page.locator('.board-canvas').boundingBox())!.y
    const pencil = page.getByRole('button', { name: 'Edit the board' })
    const tools = page.locator('.phone-build')
    const analysis = page.locator('.phone-analysis')
    await pencil.click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'true')
    await expect(tools).toBeVisible()
    await expect(analysis).toHaveCount(0)
    // The counts the board caption lost ride along on the labels (spec D3 tools).
    await expect(tools.locator('.tool-label')).toHaveText(['Terrain0/19', 'Number token', 'Structures0 pieces', 'Player'])
    expect((await page.locator('.board-canvas').boundingBox())!.y).toBe(boardTop)
    const sideways = await page.locator('.phone-page').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((el) => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth)
        .map((el) => el.className))
    expect(sideways).toEqual(['tool-grid terrain-grid', 'token-tools', 'tool-grid structure-grid'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await snap(page, 'build-mode')

    await page.getByRole('button', { name: /Board layout/ }).click()
    await page.getByRole('option', { name: '5–6 player' }).click()
    await expect(page.locator('.board-status')).toContainText('5–6 player')
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    await expect(tools).toHaveCount(0)
    await expect(analysis.locator('h2')).toHaveText('This board is empty')

    await pencil.click()
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    await page.getByRole('button', { name: 'Board options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await tools.getByRole('button', { name: 'Cancel' }).click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    await expect(tools).toHaveCount(0)
    await expect(analysis.locator('h2')).toHaveText('This board is empty')
    await snap(page, 'build-cancel')
  })

  test('a tile tool paints a tapped hex, Cancel takes it back, and analyze mode never paints', async ({ page }) => {
    await open(page)
    const board = page.locator('.board-canvas')
    const wood = page.locator('.board-canvas polygon[fill="#1e7a3a"]')
    const centre = (await board.boundingBox())!
    const tap = () => page.mouse.click(centre.x + centre.width / 2, centre.y + centre.height / 2)
    await tap()
    await expect(wood).toHaveCount(0)
    const pencil = page.getByRole('button', { name: 'Edit the board' })
    const tools = page.locator('.phone-build')
    await pencil.click()
    await tools.getByRole('button', { name: 'wood' }).click()
    await tap()
    await expect(wood).toHaveCount(1)
    await tools.getByRole('button', { name: 'Cancel' }).click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    await expect(wood).toHaveCount(0)
    await tap()
    await expect(wood).toHaveCount(0)
  })

  test('Done keeps the tiles and drops the picked tool', async ({ page }) => {
    await open(page)
    const pencil = page.getByRole('button', { name: 'Edit the board' })
    const tools = page.locator('.phone-build')
    await pencil.click()
    await expect(tools.locator('button.selected')).toHaveCount(0)
    await tools.getByRole('button', { name: 'wood' }).click()
    await expect(tools.locator('button.selected')).toHaveText('wood')
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    await tools.getByRole('button', { name: 'Done' }).click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    const analysis = page.locator('.phone-analysis')
    await expect(analysis.locator('h2')).toHaveText('Best picks')
    await expect(analysis.locator('.analysis-context')).toHaveText(/^You are/)
    await page.getByRole('button', { name: 'Board options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await pencil.click()
    await expect(tools.locator('button.selected')).toHaveCount(0)
    await snap(page, 'build-done')
  })

  test('the Player row picks whose piece a structure tool places', async ({ page }) => {
    await open(page)
    await seedUnclaimedRoster(page)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    const tools = page.locator('.phone-build')
    await page.getByRole('button', { name: 'Edit the board' }).click()
    const players = tools.locator('.player-grid button')
    await expect(players).toHaveText(['Red', 'Blue', 'Orange', 'White'])
    await expect(tools.locator('.player-grid button[aria-pressed="true"]')).toHaveText('Red')
    await tools.getByRole('button', { name: 'settlement' }).click()
    const slots = page.locator('.placement-slot')
    await expect(slots.first()).toHaveAttribute('stroke', '#c23f38')
    await players.filter({ hasText: 'Blue' }).click()
    await expect(tools.locator('.player-grid button[aria-pressed="true"]')).toHaveText('Blue')
    await expect(slots.first()).toHaveAttribute('stroke', '#3063ba')
    await slots.first().click()
    await expect(page.locator('.board-canvas g[fill="#3063ba"]')).toHaveCount(1)
    await expect(page.locator('.board-canvas g[fill="#c23f38"]')).toHaveCount(0)
    // Buttons cross-fade over 160ms, so an immediate capture shows two pressed.
    await page.waitForTimeout(400)
    await snap(page, 'build-player')
  })
})

test.describe('maps screen', () => {
  test('the title opens Maps, where boards are added, selected, renamed, closed, saved and sorted', async ({ page }) => {
    await open(page)
    const title = page.locator('.phone-title')
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const rows = screen.locator('.open-boards .list-row')
    const saved = screen.locator('.saved-maps .list-row')
    await title.click()
    await expect(screen).toBeVisible()
    await expect(screen.locator('.phone-overlay-title')).toHaveText('Maps')
    await expect(screen.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveClass(/\bcurrent\b/)
    await expect(saved).toHaveCount(0)
    await snap(page, 'maps-screen')

    await screen.getByRole('button', { name: 'New board' }).click()
    await expect(screen).toHaveCount(0)
    await expect(title).toHaveText('Board 2')
    await title.click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toHaveClass(/\bcurrent\b/)
    await expect(rows.first()).not.toHaveClass(/\bcurrent\b/)

    await screen.getByRole('button', { name: 'Switch to Board 1', exact: true }).click()
    await expect(screen).toHaveCount(0)
    await expect(title).toHaveText('Board 1')

    await title.click()
    await rows.first().getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Board 1' })
    await expect(field).toBeFocused()
    await field.fill('Thursday')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rows.first().locator('.list-row-name')).toHaveText('Thursday')
    await expect(title).toHaveText('Thursday')
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: 'Back to the board' }).click()
    await expect(screen).toHaveCount(0)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    await title.click()
    await expect(saved).toHaveCount(1)
    await expect(saved.first().locator('.list-row-name')).toHaveText('Thursday')
    await expect(saved.first().locator('.list-row-meta')).toHaveText('just now')
    await expect(screen.locator('.group-label').nth(1)).toContainText('Saved maps (1)')

    await screen.getByRole('button', { name: 'Close Board 2', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: /Sort saved maps/ }).click()
    await expect(page.getByRole('option')).toHaveText(['Last modified', 'Created', 'Last opened', 'Name'])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: 'Import and export files' }).click()
    const menu = page.getByRole('menu', { name: 'Import and export files' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Import JSON', 'Export JSON'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(screen).toBeVisible()
    await snap(page, 'maps-saved')
    await page.keyboard.press('Escape')
    await expect(screen).toHaveCount(0)
    await expect(title).toHaveText('Thursday')
  })

  test('Escape in a rename field reverts the name and leaves the screen up', async ({ page }) => {
    await open(page)
    const screen = page.getByRole('dialog', { name: 'Maps' })
    await page.locator('.phone-title').click()
    await screen.getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Board 1' })
    await field.fill('Discarded')
    await field.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(screen).toBeVisible()
    await expect(screen.locator('.open-boards .list-row-name')).toHaveText('Board 1')
    await expect(page.locator('.phone-title')).toHaveText('Board 1')
  })

  test('renaming a saved map from its row retitles the board linked to it', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const saved = screen.locator('.saved-maps .list-row')
    await page.locator('.phone-title').click()
    await expect(saved).toHaveCount(1)
    await saved.first().getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Board 1' })
    await field.fill('Friday')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(saved.first().locator('.list-row-name')).toHaveText('Friday')
    await expect(screen.locator('.open-boards .list-row-name')).toHaveText('Friday')
    await expect(page.locator('.phone-title')).toHaveText('Friday')
    await expect(screen).toBeVisible()
  })

  test('only an import that lands closes the screen', async ({ page }) => {
    await open(page)
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const importDialog = page.getByRole('dialog', { name: 'Import screenshot' })
    await page.locator('.phone-title').click()
    // Dismissed with nothing imported: the screen stays.
    await screen.getByRole('button', { name: 'Import screenshot' }).click()
    await expect(importDialog).toBeVisible()
    await importDialog.getByRole('button', { name: 'Done' }).click()
    await expect(importDialog).toHaveCount(0)
    await expect(screen).toBeVisible()
    // Closing the current board afterwards changes the active tab, which is
    // not an import either.
    await screen.getByRole('button', { name: 'New board' }).click()
    await expect(screen).toHaveCount(0)
    await page.locator('.phone-title').click()
    await screen.getByRole('button', { name: 'Close Board 2', exact: true }).click()
    await expect(screen.locator('.open-boards .list-row')).toHaveCount(1)
    await expect(screen).toBeVisible()
    // A JSON file that does not parse: a toast, and the screen stays.
    await screen.locator('input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not a board'),
    })
    await expect(page.locator('.global-notice')).toContainText('Import failed')
    await expect(screen).toBeVisible()
    // A screenshot that parses becomes the active board and takes the screen with it.
    await screen.getByRole('button', { name: 'Import screenshot' }).click()
    await importDialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/board-draft-3player.png'))
    await expect(page.locator('.phone-title')).toHaveText('board-draft-3player', { timeout: 30_000 })
    await expect(screen).toHaveCount(0)
    await expect(importDialog).toHaveCount(0)
  })
})

test.describe('players screen', () => {
  test('the dots open Players, where a row claims, a name renames, and a grip drag reseats the draft', async ({ page }) => {
    await open(page)
    await seedUnclaimedRoster(page)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    const context = page.locator('.phone-analysis .analysis-context')
    const screen = page.getByRole('dialog', { name: 'Players' })
    const rows = screen.locator('.roster-row')
    await page.getByRole('button', { name: 'Players', exact: true }).click()
    await expect(screen).toBeVisible()
    await expect(screen.locator('.phone-overlay-title')).toHaveText('Players')
    await expect(screen.locator('.phone-ohead-btn.invisible')).toHaveCount(1)
    await expect(rows).toHaveCount(4)
    await expect(rows.locator('.list-row-name')).toHaveText(['Red', 'Blue', 'Orange', 'White'])
    await expect(screen.locator('.roster-row.me')).toHaveCount(0)
    await expect(screen.locator('.draft-grid-slot')).toHaveCount(8)
    await expect(screen.locator('.draft-grid-slot.now')).toHaveCount(1)
    await expect(screen.locator('.group-label').nth(1)).toContainText('pick 1 of 8')
    await snap(page, 'players-screen')

    await screen.getByRole('button', { name: 'Claim Blue', exact: true }).click()
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(rows.nth(1).locator('.you-chip')).toBeVisible()
    await expect(rows.nth(0).locator('.you-chip')).toBeHidden()
    await expect(page.locator('.phone-dot').nth(1)).toHaveClass(/\bme\b/)
    await expect(context).toHaveText(/picking 2 and 7 of 8/)

    await rows.nth(1).getByRole('button', { name: 'Rename Blue', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Blue' })
    await expect(field).toBeFocused()
    await field.fill('Bea')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rows.nth(1).locator('.list-row-name')).toHaveText('Bea')
    await expect(context.locator('.menu-trigger strong')).toHaveText('Bea')
    await expect(screen).toBeVisible()

    await screen.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const grip = (await rows.nth(3).locator('.roster-grip').boundingBox())!
    const top = (await rows.nth(0).boundingBox())!
    const x = grip.x + grip.width / 2
    const y = grip.y + grip.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await expect(rows.nth(3)).toHaveClass(/\bdragging\b/)
    await expect(screen.locator('.roster-trash')).toBeVisible()
    await page.mouse.move(x, top.y + top.height / 2, { steps: 12 })
    await expect(rows.nth(0)).toHaveClass(/\bshift-down\b/)
    await snap(page, 'players-drag')
    await page.mouse.up()
    await expect(rows.locator('.list-row-name')).toHaveText(['White', 'Red', 'Bea', 'Orange'])
    await expect(rows.nth(0)).not.toHaveClass(/\bdragging\b/)
    await expect(screen.locator('.roster-trash')).toHaveCount(0)
    await expect(rows.nth(2)).toHaveClass(/\bme\b/)
    await expect(page.locator('.draft-ribbon-slot').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(context).toHaveText(/picking 3 and 6 of 8/)
    await expect(screen.locator('.draft-grid-name').first()).toHaveText('White')
    await snap(page, 'players-reordered')

    await screen.getByRole('button', { name: 'Add player' }).click()
    await expect(rows).toHaveCount(5)
    await expect(rows.last().locator('.list-row-name')).toHaveText('Player 5')
    await expect(page.locator('.phone-dot')).toHaveCount(5)
    await screen.getByRole('button', { name: 'Back to the board' }).click()
    await expect(screen).toHaveCount(0)
  })

  test('a swipe before the hold lands keeps the row, a hold lifts it, and the trash removes it', async ({ page }) => {
    await open(page)
    await seedUnclaimedRoster(page)
    const screen = page.getByRole('dialog', { name: 'Players' })
    const rows = screen.locator('.roster-row')
    await page.getByRole('button', { name: 'Players', exact: true }).click()
    await expect(rows).toHaveCount(4)
    await screen.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    // Pressed on the row itself, well away from the grip, and moved before
    // the hold could land: a scroll, so nothing lifts.
    const last = (await rows.nth(3).boundingBox())!
    const x = last.x + last.width * 0.8
    const y = last.y + last.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 20, { steps: 4 })
    await page.waitForTimeout(500)
    await expect(rows.nth(3)).not.toHaveClass(/\bdragging\b/)
    await expect(screen.locator('.roster-trash')).toHaveCount(0)
    await page.mouse.up()
    // Held still past the threshold: the row lifts and the trash appears.
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(500)
    await expect(rows.nth(3)).toHaveClass(/\bdragging\b/)
    const trash = screen.locator('.roster-trash')
    await expect(trash).toBeVisible()
    const bin = (await trash.boundingBox())!
    await page.mouse.move(bin.x + bin.width / 2, bin.y + bin.height / 2, { steps: 12 })
    await expect(trash).toHaveClass(/\bover\b/)
    await page.mouse.up()
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.list-row-name')).toHaveText(['Red', 'Blue', 'Orange'])
    await expect(page.locator('.phone-dot')).toHaveCount(3)
  })
})
