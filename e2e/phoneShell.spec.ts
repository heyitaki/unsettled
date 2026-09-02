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

test('the ribbon shows every pick and the board sits in a square sea', async ({ page }) => {
  await open(page)
  const players = await page.locator('.phone-dot').count()
  const slots = page.locator('.phone-rslot')
  await expect(slots).toHaveCount(players * 2)
  await expect(slots.first()).toHaveClass(/\bnow\b/)
  const frame = await page.locator('.board-canvas').boundingBox()
  expect(frame).not.toBeNull()
  expect(Math.abs(frame!.width - frame!.height)).toBeLessThanOrEqual(1)
  await snap(page, 'ribbon-board')
})

test('the six-player layout gets a taller frame under an unmoved ribbon and a bare caption', async ({ page }) => {
  await open(page)
  const ribbonTop = (await page.locator('.phone-ribbon').boundingBox())!.y
  await page.getByRole('button', { name: /Board layout/ }).click()
  await page.getByRole('option', { name: '5–6 player' }).click()
  await expect(page.locator('.board-status')).toContainText('5–6 player')
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  const frame = await page.locator('.board-canvas').boundingBox()
  expect(frame!.height).toBeGreaterThan(frame!.width)
  expect((await page.locator('.phone-ribbon').boundingBox())!.y).toBe(ribbonTop)
  const caption = await page.locator('.board-status').innerText()
  expect(caption).not.toMatch(/terrain|pieces/)
  await snap(page, 'six-player-frame')
})

/**
 * A fresh board boots with one claimed player, so the no-me state needs a
 * roster nobody has claimed. The store flushes its own workspace on pagehide,
 * so the seed runs at the start of the reloaded document, after that flush,
 * and edits only the roster fields of the stored tab.
 */
async function seedUnclaimedRoster(page: Page) {
  await page.addInitScript(() => {
    const key = 'unsettled.workspace.v1'
    const raw = localStorage.getItem(key)
    if (raw === null) return
    const workspace = JSON.parse(raw)
    const board = workspace.tabs[0].game.board
    board.players = [
      { id: 'p1', name: 'Red', color: '#c23f38' },
      { id: 'p2', name: 'Blue', color: '#3063ba' },
      { id: 'p3', name: 'Orange', color: '#e58331' },
      { id: 'p4', name: 'White', color: '#ffffff' },
    ]
    board.mePlayerId = null
    workspace.tabs[0].game.stats = {}
    delete workspace.tabs[0].activePlayerId
    localStorage.setItem(key, JSON.stringify(workspace))
  })
  await page.reload()
  await expect(page.locator('.phone-dot')).toHaveCount(4)
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

test('a filled board asks who you are, and a tapped swatch claims that seat', async ({ page }) => {
  await open(page)
  await seedUnclaimedRoster(page)
  const block = page.locator('.phone-analysis')
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await page.getByRole('button', { name: 'Board options' }).click()
  await page.getByRole('menuitem', { name: 'Randomize board' }).click()
  await expect(block.locator('h2')).toHaveText('Best picks')
  await expect(block.locator('.analysis-context')).toHaveCount(0)
  const swatches = block.locator('.phone-claim-row button')
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
    await expect(block.locator('.analysis-row.selected .analysis-rank')).toHaveText('1')
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
    await expect(tools.locator('.tool-label')).toHaveText(['Terrain', 'Number token', 'Structures'])
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
})

test.describe('maps screen', () => {
  test('the title opens Maps, where boards are added, selected, renamed, closed, saved and sorted', async ({ page }) => {
    await open(page)
    const title = page.locator('.phone-title')
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const rows = screen.locator('.phone-open-boards .phone-row')
    const saved = screen.locator('.phone-saved-maps .phone-row')
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
    await expect(rows.first().locator('.phone-row-name')).toHaveText('Thursday')
    await expect(title).toHaveText('Thursday')
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: 'Back to the board' }).click()
    await expect(screen).toHaveCount(0)
    await page.getByRole('button', { name: 'Board options' }).click()
    await page.getByRole('menuitem', { name: 'Randomize board' }).click()
    await title.click()
    await expect(saved).toHaveCount(1)
    await expect(saved.first().locator('.phone-row-name')).toHaveText('Thursday')
    await expect(saved.first().locator('.phone-row-meta')).toHaveText('just now')
    await expect(screen.locator('.phone-group-label').nth(1)).toContainText('Saved maps (1)')

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
})
