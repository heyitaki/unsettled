import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { seedBoard, seedUnclaimedRoster } from './seed'

/**
 * The desktop layout (desktop spec, The model and D3): the board beside one
 * column, with Maps, Players and the pencil beside the brand, and Import in Maps.
 */
test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const header = '.site-header'
  const title = (page: import('@playwright/test').Page) => page.locator(`${header} .head-title`)
  const pencil = (page: import('@playwright/test').Page) => page.locator(header).getByRole('button', { name: 'Edit the board' })

  test('shows the board and one column, with the controls centred beside the brand', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.analysis-panel')).toBeVisible()
    for (const hidden of ['.tools-panel', '.maps-panel', '.player-panel']) await expect(page.locator(hidden)).toBeHidden()

    const brand = (await page.locator(`${header} .brand-mark`).boundingBox())!
    const controls = [title(page), pencil(page), page.locator(`${header} .head-dots`)]
    const boxes = []
    for (const control of controls) boxes.push((await control.boundingBox())!)
    for (const box of boxes) expect(Math.abs(box.y + box.height / 2 - (brand.y + brand.height / 2))).toBeLessThanOrEqual(1)
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].x).toBeGreaterThan(boxes[index - 1].x)

    // The board is 75% of the window height wide and the column sits against it.
    const board = (await page.locator('.board-canvas').boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(board.width - 0.75 * 900)).toBeLessThan(2)
    expect(board.y + board.height).toBeLessThanOrEqual(900)
    expect(column.x).toBeGreaterThan(board.x + board.width)
    expect(column.x - (board.x + board.width)).toBeLessThan(24)
    expect(Math.round(column.width)).toBe(440)
    await expect(page.locator('.head-controls .hero-import')).toHaveCount(0)
    await title(page).click()
    await expect(page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot' })).toBeVisible()
  })

  test('Import closes Maps and Escape returns focus to the board title', async ({ page }) => {
    await page.goto('')
    await title(page).click()
    await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Maps', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(title(page)).toBeFocused()
  })

  test('the pencil swaps the column for Board tools, Cancel restores the board and Done keeps it', async ({ page }) => {
    await page.goto('')
    const tools = page.locator('.tools-panel')
    const analysis = page.locator('.analysis-panel')
    await pencil(page).click()
    await expect(pencil(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(tools.locator('h2')).toHaveText('Board tools')
    await expect(analysis).toBeHidden()
    await expect(tools.locator('.tool-label').first()).toHaveText('Layout')
    await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
    await expect(tools.locator('.tool-count').first()).toHaveText('19/19')
    await tools.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(tools).toBeHidden()
    await expect(pencil(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(analysis.locator('h2')).toHaveText('This board is empty')

    await pencil(page).click()
    await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
    await tools.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(tools).toBeHidden()
    await expect(analysis.locator('h2')).toHaveText('Best picks')
  })

  test('the pressed pencil darkens on hover and keeps its white glyph', async ({ page }) => {
    await page.goto('')
    await pencil(page).click()
    await pencil(page).hover()
    await expect(pencil(page)).toHaveCSS('background-color', 'rgb(163, 61, 41)')
    await expect(pencil(page)).toHaveCSS('color', 'rgb(255, 255, 255)')
  })

  test('an empty board offers both ways to fill it, and Build it by hand opens the tools', async ({ page }) => {
    await page.goto('')
    const analysis = page.locator('.analysis-panel')
    await expect(analysis.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
    await analysis.getByRole('button', { name: 'Build it by hand' }).click()
    await expect(page.locator('.tools-panel')).toBeVisible()
    await expect(pencil(page)).toHaveAttribute('aria-pressed', 'true')
  })

  test('the title opens Maps under itself, and Escape closes it and returns the focus', async ({ page }) => {
    await page.goto('')
    const maps = page.locator('.maps-panel')
    await title(page).click()
    await expect(maps.locator('h2')).toHaveText('Maps')
    const button = (await title(page).boundingBox())!
    const panel = (await maps.boundingBox())!
    expect(panel.y).toBeGreaterThanOrEqual(button.y + button.height)
    expect(Math.abs(panel.x - button.x)).toBeLessThan(2)
    expect(Math.round(panel.width)).toBe(400)
    await maps.getByRole('button', { name: 'New board' }).click()
    await expect(title(page)).toHaveText('Board 2')
    await expect(maps).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(maps).toBeHidden()
    await expect(title(page)).toBeFocused()
  })

  test('a second click on the title closes Maps, and Escape in a rename field stays in the field', async ({ page }) => {
    await page.goto('')
    const maps = page.locator('.maps-panel')
    await title(page).click()
    await expect(maps).toBeVisible()
    await title(page).click()
    await expect(maps).toBeHidden()
    await title(page).click()
    await maps.getByRole('button', { name: 'Rename Board 1' }).click()
    await page.keyboard.type('Scratch')
    await page.keyboard.press('Escape')
    await expect(maps).toBeVisible()
    await expect(maps.getByRole('button', { name: 'Rename Board 1' })).toBeVisible()
    await expect(title(page)).toHaveText('Board 1')
  })

  test('switching boards from Maps ends build mode', async ({ page }) => {
    await page.goto('')
    await pencil(page).click()
    await expect(page.locator('.tools-panel')).toBeVisible()
    await title(page).click()
    await page.locator('.maps-panel').getByRole('button', { name: 'New board' }).click()
    await expect(title(page)).toHaveText('Board 2')
    await expect(pencil(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.tools-panel')).toBeHidden()
    await expect(page.locator('.maps-panel')).toBeVisible()
  })

  // A page even a few pixels taller than the window scrolls, and the header jitters with it.
  test('a board filling the window height leaves the page exactly one window tall', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await page.goto('')
    await seedBoard(page, JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8')))
    const canvas = page.locator('.board-canvas')
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveCSS('max-height', 'none')
    const brand = (await page.locator(`${header} .brand-mark`).boundingBox())!
    const board = (await canvas.boundingBox())!
    const bottomPadding = await page.locator('.app-shell').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
    expect(Math.abs(board.y - brand.y)).toBeLessThan(1)
    expect(Math.abs(board.y + board.height + bottomPadding - 800)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800)
  })

  test('a short, wide window keeps the column inside the page', async ({ page }) => {
    for (const [width, height] of [[1440, 500], [1024, 500]]) {
      await page.setViewportSize({ width, height })
      await page.goto('')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const head = (await page.locator(header).boundingBox())!
      const column = (await page.locator('.analysis-panel').boundingBox())!
      expect(column.x + column.width).toBeLessThanOrEqual(head.x + head.width + 1)
    }
  })

  test('the player pill opens Players under itself, and a click outside closes it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const players = page.locator('.player-panel')
    const pill = page.locator(header).getByRole('button', { name: 'Players' })
    await pill.click()
    await expect(players.locator('h2')).toHaveText('Players')
    const button = (await pill.boundingBox())!
    const panel = (await players.boundingBox())!
    expect(panel.y).toBeGreaterThanOrEqual(button.y + button.height)
    expect(Math.abs(panel.x + panel.width - (button.x + button.width))).toBeLessThan(2)
    expect(Math.round(panel.width)).toBe(372)
    await page.mouse.click(4, 450)
    await expect(players).toBeHidden()
  })

  test('a long title truncates beside six players and the title stays aligned with the column', async ({ page }) => {
    await page.goto('')
    await seedBoard(page, { players: ['#c23f38', '#3063ba', '#e58331', '#ffffff', '#5b9a4f', '#7b4f9a']
      .map((color, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, color })), mePlayerId: 'p2' })
    await title(page).click()
    await page.locator('.maps-panel').getByRole('button', { name: 'Rename Board 1' }).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Screenshot 2026-07-23 at 12.41.07 with a much longer name')
    await page.keyboard.press('Enter')
    await title(page).click()
    const name = page.locator(`${header} .head-title-name`)
    await expect(name).toHaveText(/much longer name/)
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    const titleBox = (await title(page).boundingBox())!
    const players = (await page.locator(`${header} .head-player-controls`).boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(titleBox.x - column.x)).toBeLessThan(1)
    expect(titleBox.x + titleBox.width).toBeLessThan(players.x)
    expect(Math.abs(players.x + players.width - (column.x + column.width))).toBeLessThan(1)
  })

  test('at 900px wide the column wraps under the board', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('')
    const board = (await page.locator('.board-canvas').boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(column.y).toBeGreaterThanOrEqual(board.y + board.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900)
  })
})
