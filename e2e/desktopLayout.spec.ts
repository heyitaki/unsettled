import { expect, test } from '@playwright/test'
import { seedUnclaimedRoster } from './seed'

/**
 * The desktop layout (desktop spec, The model and D3): the board beside one
 * column, with Maps, Players, the pencil and the import in the header.
 */
test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const header = '.site-header'
  const title = (page: import('@playwright/test').Page) => page.locator(`${header} .head-title`)
  const pencil = (page: import('@playwright/test').Page) => page.locator(header).getByRole('button', { name: 'Edit the board' })

  test('shows the board and one column, with the controls in a row under the brand', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.analysis-panel')).toBeVisible()
    for (const hidden of ['.tools-panel', '.maps-panel', '.player-panel']) await expect(page.locator(hidden)).toBeHidden()

    const brand = (await page.locator(`${header} h1`).boundingBox())!
    const controls = [title(page), page.locator(header).getByRole('button', { name: 'Players' }), pencil(page), page.locator(header).getByRole('button', { name: 'Import screenshot' })]
    const boxes = []
    for (const control of controls) boxes.push((await control.boundingBox())!)
    // One row, under the brand, in this order.
    for (const box of boxes) expect(box.y).toBeGreaterThanOrEqual(brand.y + brand.height)
    for (const box of boxes.slice(1)) expect(Math.abs(box.y + box.height / 2 - (boxes[0].y + boxes[0].height / 2))).toBeLessThan(2)
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].x).toBeGreaterThan(boxes[index - 1].x)

    // The board is 75% of the window height wide and the column sits against it.
    const board = (await page.locator('.board-canvas').boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(board.width - 0.75 * 900)).toBeLessThan(2)
    expect(board.y + board.height).toBeLessThanOrEqual(900)
    expect(column.x).toBeGreaterThan(board.x + board.width)
    expect(column.x - (board.x + board.width)).toBeLessThan(24)
    expect(Math.round(column.width)).toBe(440)
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
    expect(Math.round(panel.width)).toBe(320)
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
    await page.locator(`${header} h1`).click()
    await expect(players).toBeHidden()
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
