import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { placeRoad } from '../src/model/board'
import { edgeEndpointVertexIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
import { awaitingFirstTurn, setActivePlayer } from '../src/model/turn'
import { finishedDraft } from '../src/ui/__tests__/finishedDraft'
import { seedBoard, seedUnclaimedRoster } from './seed'

/**
 * The desktop layout (desktop spec, The model and D3): the board beside one
 * column centred on the window, with Maps, Players and the pencil heading the
 * column, Maps and Players opening as cards in it, and Import in Maps.
 */
test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const header = '.site-header'
  const controls = '.head-controls'
  const title = (page: import('@playwright/test').Page) => page.locator(`${controls} .head-title`)
  const pencil = (page: import('@playwright/test').Page) => page.locator(controls).getByRole('button', { name: 'Edit the board' })

  test('shows the board and one column centred on the window, with the controls heading the column', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.analysis-panel')).toBeVisible()
    for (const hidden of ['.tools-panel', '.maps-panel', '.player-panel']) await expect(page.locator(hidden)).toBeHidden()
    await expect(page.locator(`${header} ${controls}`)).toHaveCount(0)

    const items = [title(page), pencil(page), page.locator(`${controls} .head-dots`)]
    const boxes = []
    for (const item of items) boxes.push((await item.boundingBox())!)
    for (const box of boxes) expect(Math.abs(box.y + box.height / 2 - (boxes[0].y + boxes[0].height / 2))).toBeLessThanOrEqual(1)
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].x).toBeGreaterThan(boxes[index - 1].x)

    // The board's box and the column, controls included, share the window's vertical centre; the board is as wide as its box is tall.
    const board = (await page.locator('.board-canvas').boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(board.y + board.height / 2 - 450)).toBeLessThan(1)
    expect(Math.abs((boxes[0].y + column.y + column.height) / 2 - 450)).toBeLessThan(1)
    expect(Math.abs(column.y - (boxes[0].y + boxes[0].height + 12))).toBeLessThan(1)
    expect(Math.abs(board.width - board.height)).toBeLessThan(2)
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
    await expect(page.locator('.maps-panel')).toHaveCount(0)
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

  test('the title opens Maps in place of the column\'s cards, and Escape closes it and returns the focus', async ({ page }) => {
    await page.goto('')
    const maps = page.locator('.maps-panel')
    await title(page).click()
    await expect(maps.locator('h2')).toHaveText('Maps')
    await expect(page.locator('.analysis-panel')).toBeHidden()
    const button = (await title(page).boundingBox())!
    const panel = (await maps.boundingBox())!
    expect(Math.abs(panel.y - (button.y + button.height + 12))).toBeLessThan(1)
    expect(Math.abs(panel.x - button.x)).toBeLessThan(1)
    expect(Math.round(panel.width)).toBe(440)
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
    // The board starts under the header's 12px bottom margin and keeps the same room below, so it centres on the window.
    expect(Math.abs(board.y - (brand.y + brand.height + 12))).toBeLessThan(1)
    expect(Math.abs(800 - (board.y + board.height) - board.y)).toBeLessThan(1)
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

  test('the player pill adds Players above the column\'s cards, and a second click closes it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const players = page.locator('.player-panel')
    const pill = page.locator(controls).getByRole('button', { name: 'Players' })
    await pill.click()
    await expect(players.locator('h2')).toHaveText('Players')
    await expect(page.locator('.analysis-panel')).toBeVisible()
    // The cards glide into place; only the unclaimed pill's nudge loops forever.
    await page.locator('.right-rail').evaluate((node) => Promise.all(node.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)))
    const button = (await pill.boundingBox())!
    const panel = (await players.boundingBox())!
    const analysis = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(panel.y - (button.y + button.height + 12))).toBeLessThanOrEqual(1)
    expect(Math.abs(analysis.y - (panel.y + panel.height + 12))).toBeLessThanOrEqual(1)
    expect(Math.round(panel.width)).toBe(440)
    // The card fades out where it stood (its copy keeps the card's box, read before the card left the page)
    // and closes with the gap, so the controls gliding down never pass over it.
    const { ghost, clearance } = await pill.evaluate(async (button) => {
      (button as HTMLElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const copy = document.querySelector('.right-rail > .player-panel[data-ghost]')
      const controls = document.querySelector('.right-rail > .head-controls')!
      if (!copy) return { ghost: null, clearance: [] }
      const ghost = JSON.parse(JSON.stringify(copy.getBoundingClientRect())) as DOMRect
      const clearance: number[] = []
      for (let frame = 0; frame < 10; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        if (!copy.isConnected) break
        const cut = parseFloat(/^inset\(([^ )]*)/.exec(getComputedStyle(copy).clipPath)?.[1] ?? '0')
        clearance.push(copy.getBoundingClientRect().top + Math.max(0, cut) - controls.getBoundingClientRect().bottom)
      }
      return { ghost, clearance }
    })
    expect(ghost).not.toBeNull()
    expect(Math.abs(ghost!.x - panel.x)).toBeLessThan(1)
    expect(Math.abs(ghost!.width - panel.width)).toBeLessThan(1)
    expect(clearance.length).toBeGreaterThan(3)
    for (const gap of clearance) expect(gap).toBeGreaterThanOrEqual(-1)
    await expect(players).toBeHidden()
  })

  // The column scrolls rather than cut a card short, and the page itself never scrolls.
  test('a column taller than the window scrolls whole, with Players at its full height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 560 })
    await page.goto('')
    await seedUnclaimedRoster(page)
    await page.locator(controls).getByRole('button', { name: 'Players' }).click()
    const players = page.locator('.player-panel')
    await expect(players).toBeVisible()
    expect(await players.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
    expect(await page.locator('.right-rail').evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
    expect(await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth])).toEqual([560, 1440])
    await page.locator('.right-rail').evaluate((node) => { node.scrollTop = node.scrollHeight })
    const analysis = (await page.locator('.analysis-panel').boundingBox())!
    expect(analysis.y + analysis.height).toBeLessThanOrEqual(560)
  })

  // Best moves is as tall as its rows while the column has room, shrinks toward its floor when the column
  // would overflow, and takes its full height again once even the floor overflows, the column scrolling instead.
  test('Best moves grows into the column, shrinks to fit it, and gives way to the column scrolling', async ({ page }) => {
    await page.goto('')
    const game = finishedDraft(0)
    let board = game.board
    const grid = boardGrid(board.layout)
    for (const { vertexId, playerId } of board.buildings) {
      const edge = grid.edgeIds.find((id) => edgeEndpointVertexIds(id).includes(vertexId) && !board.roads.some((road) => road.edgeId === id))!
      board = placeRoad(board, edge, playerId)
    }
    const seeded = { ...game, board }
    await seedBoard(page, board, {}, awaitingFirstTurn(seeded) ? setActivePlayer(seeded, board.players[0].id).turn : undefined)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('group', { name: 'Dice total' }).getByRole('button', { name: '8', exact: true }).click()
    await expect(page.locator('.moves-panel .analysis-row').first()).toBeVisible({ timeout: 60_000 })
    const hidden = (selector: string) => page.locator(selector).evaluate((node) => node.scrollHeight - node.clientHeight)
    const body = '.moves-panel > .moves-body'
    const rail = page.locator('.right-rail')
    await expect.poll(() => hidden(body)).toBeLessThanOrEqual(1)
    expect(await hidden('.right-rail')).toBeLessThanOrEqual(1)
    const full = await page.locator('.moves-panel').evaluate((node) => node.getBoundingClientRect().height)
    expect(full).toBeGreaterThan(165)

    // A window 10px short of the column: the rail's max height is 100vh - 4vh + 12px here, so Best moves gives up 10px.
    const column = await rail.evaluate((node) => node.clientHeight)
    await page.setViewportSize({ width: 1440, height: Math.ceil((column - 10 - 12) / .96) })
    await expect.poll(() => hidden(body)).toBeGreaterThan(5)
    expect(await hidden('.right-rail')).toBeLessThanOrEqual(1)
    await expect(rail).not.toHaveClass(/overfull/)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator(controls).getByRole('button', { name: 'Players' }).click()
    await expect(rail).toHaveClass(/overfull/)
    expect(await hidden(body)).toBeLessThanOrEqual(1)
    expect(await hidden('.right-rail')).toBeGreaterThan(1)
    await page.locator(controls).getByRole('button', { name: 'Players' }).click()
    await expect(rail).not.toHaveClass(/overfull/)
    expect(await hidden(body)).toBeLessThanOrEqual(1)
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
    const name = page.locator(`${controls} .head-title-name`)
    await expect(name).toHaveText(/much longer name/)
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    const titleBox = (await title(page).boundingBox())!
    const players = (await page.locator(`${controls} .head-player-controls`).boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(Math.abs(titleBox.x - column.x)).toBeLessThan(1)
    expect(titleBox.x + titleBox.width).toBeLessThan(players.x)
    expect(Math.abs(players.x + players.width - (column.x + column.width))).toBeLessThan(1)
  })

  test('at 900px wide the column wraps under the board and the controls return to the header', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('')
    await expect(page.locator(`${header} ${controls}`)).toBeVisible()
    await expect(page.locator(`.right-rail ${controls}`)).toHaveCount(0)
    const board = (await page.locator('.board-canvas').boundingBox())!
    const column = (await page.locator('.analysis-panel').boundingBox())!
    expect(column.y).toBeGreaterThanOrEqual(board.y + board.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900)
  })
})
