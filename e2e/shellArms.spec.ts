import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createBoard, draftOrder, placeBuilding, placeRoad, setHexTile } from '../src/model/board'
import { createEngine } from '../src/engine/advice/wasm'
import { inferDraftState } from '../src/engine/draft'
import { axialToPixel, edgeEndpointVertexIds, hexVertexIds, parseVertexId, vertexAdjacentVertexIds, vertexIncidentEdgeIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
import type { Board, VertexId } from '../src/model/types'
import { LISTED_PICKS } from '../src/ui/restMarks'
import { buildingSlots } from '../src/ui/placementSlots'
import { seedBoard, seedSavedMaps, seedUnclaimedRoster, todayTitle, UNCLAIMED_ROSTER } from './seed'

/**
 * The `Workspace` tree, which every viewport wider than 760px gets (spec B8),
 * a landscape phone included; anything narrower mounts `PhoneShell` whatever
 * its orientation or pointer.
 */

/** Viewport shots preserve local selections and open popovers across Chromium captures. */
const snap = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: `test-results/phone/${name}.png`, fullPage, animations: 'disabled' })

const pencil = (page: Page) => page.locator('.head-controls').getByRole('button', { name: 'Edit the board' })

async function openBuild(page: Page) {
  if (await pencil(page).getAttribute('aria-pressed') !== 'true') await pencil(page).click()
}

async function openMaps(page: Page) {
  if (!await page.locator('.maps-panel').isVisible()) await page.locator('.head-controls .head-title').click()
}

// The desktop column glides its cards into place; measure them once they land. Only the unclaimed pill's nudge loops forever.
const columnSettled = (page: Page) => page.evaluate(() => Promise.all((document.querySelector('.right-rail')?.getAnimations({ subtree: true }) ?? [])
  .filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)))

async function openPlayers(page: Page) {
  if (!await page.locator('.player-panel').isVisible()) await page.locator('.head-controls').getByRole('button', { name: 'Players' }).click()
  await columnSettled(page)
}

async function randomize(page: Page) {
  await openBuild(page)
  await page.getByRole('button', { name: 'Randomize', exact: true }).click()
  await page.locator('.tools-panel').getByRole('button', { name: 'Done', exact: true }).click()
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

    await openMaps(page)
    const maps = page.locator('.maps-panel')
    const rows = maps.locator('.board-list .list-row')
    await expect(maps).toBeVisible()
    await expect(page.locator('.head-controls .hero-import')).toHaveCount(0)
    await expect(maps.locator('.hero-import')).toHaveCount(1)
    await expect(maps.locator('.hero-import')).toHaveText('Import screenshot')
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
    await expect(menu.getByRole('menuitem')).toHaveText(['Import JSON', 'Export JSON', 'Back up library', 'Restore library backup'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await snap(page, 'desktop')

    // An edit is all it takes to reach the library: there is no save button,
    // and the saved board is the same row, now stamped, not a second list.
    await randomize(page)
    await openMaps(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.list-row-meta')).toHaveText('Just now')

    await rows.first().getByRole('button', { name: `Rename ${todayTitle('aki')}`, exact: true }).click()
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

  test('claims a player from the draft ribbon while the board wears resting marks', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('footer')).toHaveCount(0)
    await seedUnclaimedRoster(page)
    await randomize(page)
    await page.locator('.claim-row button').first().click()

    // Two picks per player, the first one up (spec D4).
    const players = await page.locator('.head-dot').count()
    const ribbon = page.locator('.analysis-panel .draft-ribbon')
    const slots = ribbon.locator('.draft-ribbon-slot')
    await expect(ribbon).toHaveCount(1)
    await openPlayers(page)
    await expect(page.locator('.player-panel')).toBeVisible()
    await expect(page.locator('.player-panel .draft-ribbon')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.mouse.move(0, 0)
    await expect(slots).toHaveCount(players * 2)
    await expect(slots.first()).toHaveClass(/\bviewing\b/)

    // The board rests on the ranked picks, all solid (spec D4).
    const marks = page.locator('.vertex-highlight')
    await expect(marks).toHaveCount(LISTED_PICKS)
    await expect(page.locator('.vertex-highlight.faded')).toHaveCount(0)

    await expect(page.locator('.board-status')).toHaveCount(0)
    await snap(page, 'desktop-ribbon')

    await slots.nth(1).click()
    await expect(page.locator('.analysis-context .menu-trigger strong')).toHaveText('Blue')
    await expect(page.locator('.analysis-context')).toHaveText('Blue · Picking 2nd and 7th', { useInnerText: true })
    await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'false')
    await expect(slots.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(slots.nth(6)).toHaveAttribute('aria-pressed', 'true')
    await expect(ribbon.locator('[aria-pressed="true"]')).toHaveCount(2)
    // The ring follows the claim onto a pick that is still to come.
    await expect(slots.nth(1)).toHaveClass(/\bviewing\b/)
    await expect(ribbon.locator('.viewing')).toHaveCount(1)
    await expect(slots.nth(1)).toHaveAccessibleName('Pick 2: Blue')

    await slots.first().click()
    await expect(page.locator('.analysis-context .menu-trigger strong')).toHaveText('Red')
    await expect(marks).toHaveCount(LISTED_PICKS)
    await page.locator('.analysis-row-select').first().click()
    await expect(page.locator('.analysis-row.current')).toHaveCount(1)
    await expect(marks).toHaveCount(2)

    // Claiming the same player leaves the pinned card alone.
    await slots.first().click()
    await expect(slots.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.analysis-row.current')).toHaveCount(1)
    await expect(marks).toHaveCount(2)
  })

  test('a later pick is viewed from its own circle, behind every pick before it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await randomize(page)
    await page.locator('.claim-row button').first().click()
    const panel = page.locator('.analysis-panel')
    const slots = panel.locator('.draft-ribbon-slot')
    const context = panel.locator('.analysis-context')
    const gone = panel.locator('.analysis-likely-gone')
    await expect(context).toHaveText('Red · Picking 1st and 8th', { useInnerText: true })
    await expect(gone).toHaveCount(0)

    // Red's second pick closes the snake: seven picks stand before it, Red's own first among them.
    await slots.nth(7).click()
    await expect(slots.nth(7)).toHaveClass(/\bviewing\b/)
    await expect(panel.locator('.draft-ribbon-slot.viewing')).toHaveCount(1)
    await expect(context).toHaveText('Red · Picking 8th', { useInnerText: true })
    await expect(gone.locator('.analysis-gone-entry > span:first-child').last()).toHaveText('7. Blue', { timeout: 60_000 })
    await expect(gone.locator('.analysis-gone-entry > span:first-child').first()).toHaveText('1. Red')
    await expect(panel.locator('.analysis-row').first()).toBeVisible()

    // A rival's circle shows that rival's pick and leaves YOU on Red.
    const rows = page.locator('.player-list .roster-row')
    await slots.nth(1).click()
    await expect(slots.nth(1)).toHaveClass(/\bviewing\b/)
    await expect(slots.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'false')
    await expect(context).toHaveText('Blue · Picking 2nd and 7th', { useInnerText: true })
    // The last view's cards stay in place while this one is ranked, so wait for the bar to go.
    await expect(panel.locator('.analysis-loading')).toHaveCount(0, { timeout: 60_000 })
    await expect(gone).toContainText('1. Red', { timeout: 60_000 })
    await openPlayers(page)
    await expect(rows.nth(0)).toHaveClass(/\bme\b/)
    await expect(rows.locator('.you-chip')).toHaveCount(1)
    await expect(rows.nth(0).locator('.you-chip')).toBeVisible()
    // The marks on the board are in the viewed player's colour.
    await expect(page.locator('.vertex-highlight').first()).toHaveCSS('fill', 'rgb(48, 99, 186)')

    await page.keyboard.press('Escape')

    // So does the rival's later pick, behind their own first.
    await slots.nth(6).click()
    await expect(slots.nth(6)).toHaveClass(/\bviewing\b/)
    await expect(context).toHaveText('Blue · Picking 7th', { useInnerText: true })
    await expect(gone).toContainText('6. Orange', { timeout: 60_000 })
    await expect(gone).toContainText('2. Blue')
    await openPlayers(page)
    await expect(rows.nth(0)).toHaveClass(/\bme\b/)

    await page.keyboard.press('Escape')

    // The name menu switches the view the same way.
    await context.locator('.menu-trigger').click()
    await page.getByRole('option', { name: 'Orange' }).click()
    await expect(slots.nth(2)).toHaveClass(/\bviewing\b/)
    await expect(context).toHaveText('Orange · Picking 3rd and 6th', { useInnerText: true })
    await openPlayers(page)
    await expect(rows.nth(0)).toHaveClass(/\bme\b/)

    // Claiming in Players moves YOU and brings the view back to it.
    await openPlayers(page)
    await rows.nth(3).getByRole('button', { name: 'Claim White', exact: true }).click()
    await expect(rows.nth(3).locator('.you-chip')).toBeVisible()
    await expect(rows.locator('.you-chip')).toHaveCount(1)
    await expect(slots.nth(3)).toHaveClass(/\bviewing\b/)
    await expect(context).toHaveText('White · Picking 4th and 5th', { useInnerText: true })

    await page.keyboard.press('Escape')

    // Red is a rival now and still viewable; White's own circle returns to the default view.
    await slots.nth(0).click()
    await expect(context).toHaveText('Red · Picking 1st and 8th', { useInnerText: true })
    await expect(panel.locator('.analysis-loading')).toHaveCount(0, { timeout: 60_000 })
    await expect(gone).toHaveCount(0)
    await slots.nth(3).click()
    await expect(slots.nth(3)).toHaveClass(/\bviewing\b/)
    await expect(context).toHaveText('White · Picking 4th and 5th', { useInnerText: true })
  })

  test('steps back and forward through a draft without a claimed player', async ({ page }) => {
    await page.goto('')
    await expect(page.locator('.workspace')).toBeVisible()
    let board = setHexTile({ ...createBoard('standard4'), players: UNCLAIMED_ROSTER, mePlayerId: null }, { q: 0, r: 0 }, 'ore')
    const grid = boardGrid(board.layout)
    const vertices = grid.vertexIds.filter((_, index) => index % 6 === 0).slice(0, 8)
    // One pick short of done: a finished draft shows the recap or Best moves, neither with step buttons.
    draftOrder(board).slice(0, 7).forEach((playerId, index) => {
      board = placeBuilding(board, vertices[index], playerId, 'settlement')
    })
    const edge = grid.edgeIds.find((edgeId) => edgeEndpointVertexIds(edgeId).includes(vertices[6]))!
    board = placeRoad(board, edge, 'p2')
    await seedBoard(page, board)

    const panel = page.locator('.analysis-panel')
    const back = panel.getByRole('button', { name: 'Step back one pick' })
    const forward = panel.getByRole('button', { name: 'Step forward one pick' })
    const blue = page.locator('.board-canvas g[fill="#3063ba"]')
    const orange = page.locator('.board-canvas g[fill="#e58331"]')
    const road = page.locator('.board-canvas rect[fill="#3063ba"]')
    await expect(panel.locator('.analysis-context')).toHaveCount(0)
    await expect(back).toBeEnabled()
    await expect(forward).toBeDisabled()
    await expect(blue).toHaveCount(2)
    await expect(road).toHaveCount(1)
    const placements = await blue.evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute('transform')))
    await back.click()
    await expect(blue).toHaveCount(1)
    await expect(road).toHaveCount(0)
    await back.click()
    await expect(orange).toHaveCount(1)
    await forward.click()
    await expect(orange).toHaveCount(2)

    await panel.getByRole('button', { name: 'Pick 2: Blue', exact: true }).click()
    await expect(panel.locator('.analysis-context .menu-trigger strong')).toHaveText('Blue')
    await expect(forward).toBeEnabled()
    await forward.click()
    await expect(blue).toHaveCount(2)
    await expect(road).toHaveCount(1)
    expect(await blue.evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute('transform')))).toEqual(placements)
    await expect(forward).toBeDisabled()

    await back.click()
    // Changing the claim keeps the step list while the piece arrays stay the same.
    await openPlayers(page)
    await page.locator('.player-list .roster-row').first().getByRole('button', { name: 'Claim Red', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(panel.locator('.analysis-context .menu-trigger strong')).toHaveText('Red')
    await expect(forward).toBeEnabled()

    await openMaps(page)
    await page.getByRole('button', { name: 'New board' }).click()
    await page.getByRole('button', { name: 'Switch to Board 1', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(forward).toBeDisabled()
  })

  test('the tool heading holds undo and redo, and the tool labels carry the counts', async ({ page }) => {
    await page.goto('')
    await openBuild(page)
    const heading = page.locator('.tools-panel .panel-heading')
    expect(await heading.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
      .toEqual(['Undo', 'Redo', 'Close board tools'])
    await expect(heading.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await expect(heading.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
    await expect(page.locator('.tools-panel .structure-grid button').filter({ hasText: 'Clear board' })).toHaveClass(/\bdanger\b/)
    await page.screenshot({ path: 'test-results/phone/desktop-tools-actions.png' })
    await page.locator('.tools-panel').getByRole('button', { name: 'Randomize', exact: true }).click()

    const labels = page.locator('.tools-panel .tool-label')
    const terrain = labels.filter({ hasText: 'Terrain' }).locator('.tool-count')
    await expect(terrain).toHaveText('19/19')
    await expect(labels.filter({ hasText: 'Number token' }).locator('.tool-count')).toHaveText('18/18')
    await expect(labels.filter({ hasText: 'Board' }).locator('.tool-count')).toHaveCount(0)
    await snap(page, 'desktop-tools')

    await heading.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(terrain).toHaveText('0/19')
    await heading.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(terrain).toHaveText('19/19')
  })

  test('randomize asks before replacing a board that has something on it, and offers a new board', async ({ page }) => {
    await page.goto('')
    const dialog = page.getByRole('dialog', { name: 'Randomize this board?' })
    const tokenText = page.locator('.board-canvas .token-text')
    const tokens = () => tokenText.allTextContents()
    const boards = page.locator('.maps-panel .group-label')

    // A blank board has nothing to lose, and neither does a deal nobody has touched.
    await randomize(page)
    await expect(tokenText).toHaveCount(18)
    const first = await tokens()
    await randomize(page)
    await expect(dialog).toHaveCount(0)
    await expect.poll(tokens).not.toEqual(first)
    const second = await tokens()

    // Reopened, the same board is a saved one, so it asks.
    await page.reload()
    await openBuild(page)
    await page.getByRole('button', { name: 'Randomize', exact: true }).click()
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: 'test-results/phone/desktop-randomize-confirm.png' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await tokens()).toEqual(second)

    await page.getByRole('button', { name: 'Randomize', exact: true }).click()
    await dialog.getByRole('button', { name: 'New board' }).click()
    await openMaps(page)
    await expect(boards).toContainText('Boards (2)')
    await expect(tokenText).toHaveCount(18)
    const third = await tokens()
    expect(third).not.toEqual(second)
    // The new board is itself a fresh deal, so it deals again without asking.
    await randomize(page)
    await expect(dialog).toHaveCount(0)
    await expect.poll(tokens).not.toEqual(third)
    await openMaps(page)
    await page.getByRole('button', { name: `Switch to ${todayTitle('aki')}`, exact: true }).click()
    await expect.poll(tokens).toEqual(second)

    await openBuild(page)
    await page.getByRole('button', { name: 'Randomize', exact: true }).click()
    await dialog.getByRole('button', { name: 'Replace' }).click()
    await page.locator('.tools-panel').getByRole('button', { name: 'Done', exact: true }).click()
    await openMaps(page)
    await expect(dialog).toHaveCount(0)
    await expect.poll(tokens).not.toEqual(second)
    await expect(boards).toContainText('Boards (2)')
  })

  test('dropdowns are the phone sheet: a glyph trigger and a tick on the current option', async ({ page }) => {
    await page.goto('')
    await openMaps(page)
    const trigger = page.getByRole('button', { name: /Sort boards/ })
    await expect(trigger.locator('svg')).toHaveCount(1)
    await expect(trigger).not.toContainText('▾')

    await trigger.click()
    const popup = page.getByRole('listbox', { name: 'Sort boards' })
    const active = popup.locator('button.active')
    await expect(active).toHaveCount(1)
    await expect(active.locator('.menu-tick')).toBeVisible()
    // Laid out on every option so the labels line up, painted on the current one only.
    await expect(popup.getByRole('option')).toHaveCount(4)
    const lastOption = popup.getByRole('option').last()
    expect(await lastOption.evaluate((option) => {
      const box = option.getBoundingClientRect()
      return option.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
    })).toBe(true)
    await expect(page.locator('.maps-panel')).toBeVisible()
    await expect(popup.locator('.menu-tick')).toHaveCount(4)
    const others = popup.locator('button:not(.active) .menu-tick')
    await expect(others).toHaveCount(3)
    for (const tick of await others.all()) await expect(tick).toBeHidden()
    await page.keyboard.press('Escape')

    // The dots menu is the phone's sheet (spec D6 menus).
    await page.getByRole('button', { name: 'Import and export files' }).click()
    const sheet = page.getByRole('menu', { name: 'Import and export files' })
    await expect(sheet).toHaveClass(/\bsheet-menu\b/)
    await expect(page.locator('.maps-panel')).toBeVisible()
    await expect(sheet.getByRole('menuitem').first().locator('.menu-icon')).toBeVisible()
    await snap(page, 'desktop-menus')
  })

  test('the pencil toggles the tools, and a tool outside build mode never paints', async ({ page }) => {
    await page.goto('')
    const tools = page.locator('.tools-panel')
    const terrain = tools.locator('.tool-label').filter({ hasText: 'Terrain' }).locator('.tool-count')
    const toggle = pencil(page)
    const box = (await page.locator('.board-canvas').boundingBox())!
    const clickBoard = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(tools.locator('.terrain-grid')).toBeHidden()
    // No tool is picked on boot, so a board click must not paint (spec D3).
    await clickBoard()
    await expect(page.locator('.analysis-panel h2')).toHaveText('This board is empty')

    await toggle.click()
    await expect(terrain).toHaveText('0/19')
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    await tools.getByRole('button', { name: 'wood' }).click()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(1)
    await clickBoard()
    await expect(terrain).toHaveText('1/19')

    // Leaving build mode drops the tool, so opening again starts with none picked.
    await toggle.click()
    await toggle.click()
    await expect(tools.locator('.terrain-grid')).toBeVisible()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)

    // Nor does a tool outlive a trip through the phone tree, which never showed it.
    await tools.getByRole('button', { name: 'wood' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.phone-shell')).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await toggle.click()
    await expect(tools.locator('.terrain-grid')).toBeVisible()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
  })

  test('corners place pieces on an empty board only in build mode', async ({ page }) => {
    await page.goto('')
    const tools = page.locator('.tools-panel')
    const toggle = pencil(page)
    const svg = page.locator('.board-canvas')
    const buildings = svg.locator('g[filter="url(#piece-shadow)"]')
    const corners = hexVertexIds({ q: 0, r: 0 })
    const clickCorner = async (vertex: typeof corners[number]) => {
      const points = parseVertexId(vertex).map((coord) => axialToPixel(coord, 58))
      const corner = { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
      const point = await svg.evaluate((element, corner) => {
        const point = new DOMPoint(corner.x, corner.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
        return { x: point.x, y: point.y }
      }, corner)
      await page.mouse.click(point.x, point.y)
    }
    await expect(tools.locator('.structure-grid')).toBeHidden()
    await clickCorner(corners[0])
    await expect(buildings).toHaveCount(0)

    await toggle.click()
    await expect(tools.locator('.structure-grid button')).toHaveText(['Randomize', 'Clear pieces', 'Clear board'])
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    await expect(tools.locator('.tool-hint')).toHaveText('Tap the board to edit pieces, the robber and ports. Pick a terrain or number, then tap a tile. A picked terrain turns a tapped port 2:1. Tap a player circle at the top to place pieces for that player.')
    await expect(svg.locator('.placement-slot').first()).toBeVisible()
    await clickCorner(corners[0])
    await expect(buildings).toHaveCount(1)
    await expect(buildings.locator('g[transform*="scale(0.72)"]')).toHaveCount(1)

    await toggle.click()
    await expect(svg.locator('.placement-slot')).toHaveCount(0)
    await clickCorner(corners[3])
    await expect(buildings).toHaveCount(1)
  })

  test('draft taps on a Best picks circle place the viewed settlement and advance outside build mode', async ({ page }) => {
    // A tap lays the settlement with the setup road a ranking of that seat would draw for it.
    const engine = await createEngine(readFileSync('src/engine/advice/engine.wasm'), () => {})
    const tapPlaced = (board: Board, vertexId: VertexId, playerId: string) => {
      const response = engine.setupRoad(JSON.stringify({ board, playerId, vertexId }))
      if ('error' in response) throw new Error(response.error)
      const { road } = response
      const settled = placeBuilding(board, vertexId, playerId, 'settlement')
      return road === null ? settled : placeRoad(settled, road, playerId)
    }
    await page.goto('')
    let board: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
    board = { ...board, players: UNCLAIMED_ROSTER, mePlayerId: UNCLAIMED_ROSTER[0].id }
    await seedBoard(page, board)
    await expect(page.locator('.tools-panel .structure-grid')).toBeHidden()
    const panel = page.locator('.analysis-panel')
    const slots = panel.locator('.draft-ribbon-slot')
    const viewedSlot = 1
    const player = board.players.find((player) => player.id === inferDraftState(board).sequence[viewedSlot])!
    await slots.nth(viewedSlot).click()
    await expect(slots.nth(viewedSlot)).toHaveClass(/\bviewing\b/)
    await page.mouse.move(0, 0)
    await expect(panel.locator('.analysis-loading')).toHaveCount(0, { timeout: 60_000 })
    const svg = page.locator('.board-canvas')
    const marks = svg.locator('.vertex-highlight')
    const dots = svg.locator('.placement-slot')
    const buildings = svg.locator('g[filter="url(#piece-shadow)"] > g, g[filter="url(#piece-highlight)"] > g')
    await expect(marks).toHaveCount(LISTED_PICKS)
    await expect(svg.locator('.vertex-highlight-label').first()).toHaveText('1')
    await expect(dots).toHaveCount(0)
    const marked = await marks.evaluateAll((marks) => marks.map((mark) => ({ x: Number(mark.getAttribute('cx')), y: Number(mark.getAttribute('cy')) })))
    const corners = boardGrid(board.layout).vertexIds.map((ref) => {
      const points = parseVertexId(ref).map((coord) => axialToPixel(coord, 58))
      return { ref, x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
    })
    const cornerPoint = (corner: typeof corners[number]) => svg.evaluate((element, corner) => {
      const point = new DOMPoint(corner.x, corner.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
      return { x: point.x, y: point.y }
    }, corner)
    const clickCorner = async (corner: typeof corners[number]) => {
      const point = await cornerPoint(corner)
      await page.mouse.click(point.x, point.y)
    }
    // A legal corner out of reach of every circle: nothing is placed there.
    const legal = new Set<string>(buildingSlots(board, player.id, 'settlement', 'edit'))
    await clickCorner(corners.find((corner) => legal.has(corner.ref) &&
      marked.every((mark) => Math.hypot(mark.x - corner.x, mark.y - corner.y) > 58))!)
    const first = corners.find((corner) => corner.x === marked[0].x && corner.y === marked[0].y)!
    // Hovering a circle swaps it for the planned settlement rather than drawing the two over each other.
    const hovered = await cornerPoint(first)
    await page.mouse.move(hovered.x, hovered.y)
    await expect(svg.locator('path.placement-hover.planned-piece')).toHaveCount(1)
    await expect(marks).toHaveCount(LISTED_PICKS - 1)
    await expect(svg).toHaveCSS('cursor', 'pointer')
    await clickCorner(first)
    board = tapPlaced(board, first.ref, player.id)
    await expect(buildings).toHaveCount(1)
    await expect(buildings).toHaveAttribute('fill', player.color)
    await expect(buildings).toHaveAttribute('transform', `translate(${first.x} ${first.y}) scale(0.72)`)
    const nextSlot = inferDraftState(board).remainingPickIndices[0]
    await expect(slots.nth(nextSlot)).toHaveClass(/\bviewing\b/)
    await expect(panel.locator('.draft-ribbon-slot.viewing')).toHaveCount(1)
    await page.mouse.move(0, 0)
    await expect(panel.locator('.analysis-loading')).toHaveCount(0, { timeout: 60_000 })
    await expect(marks).toHaveCount(LISTED_PICKS)
    const nextPlayer = board.players.find((player) => player.id === inferDraftState(board).sequence[nextSlot])!
    await expect(dots).toHaveCount(0)
    const nextMark = await marks.first().evaluate((mark) => ({ x: Number(mark.getAttribute('cx')), y: Number(mark.getAttribute('cy')) }))
    const second = corners.find((corner) => corner.x === nextMark.x && corner.y === nextMark.y)!
    await clickCorner(second)
    board = tapPlaced(board, second.ref, nextPlayer.id)
    await expect(buildings).toHaveCount(2)
    await expect(buildings.nth(1)).toHaveAttribute('fill', nextPlayer.color)
    await expect(buildings.nth(1)).toHaveAttribute('transform', `translate(${second.x} ${second.y}) scale(0.72)`)
    const followingSlot = inferDraftState(board).remainingPickIndices[0]
    await expect(slots.nth(followingSlot)).toHaveClass(/\bviewing\b/)
    // With the next ranking's circles back, the placed piece still takes no tap.
    await expect(marks).toHaveCount(LISTED_PICKS, { timeout: 60_000 })
    await clickCorner(second)
    await expect(buildings).toHaveCount(2)
    await expect(buildings.nth(1)).toHaveAttribute('transform', `translate(${second.x} ${second.y}) scale(0.72)`)
    await expect(slots.nth(followingSlot)).toHaveClass(/\bviewing\b/)
    expect(board.roads).toHaveLength(2)
    await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(board.roads.length)
  })

  test('deselecting a terrain tool returns to placing pieces', async ({ page }) => {
    await page.goto('')
    const tools = page.locator('.tools-panel')
    await openBuild(page)
    const terrain = tools.getByRole('button', { name: 'wood', exact: true })
    await terrain.click()
    await expect(terrain).toHaveClass('selected')
    await terrain.click()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    const svg = page.locator('.board-canvas')
    await expect(svg.locator('.placement-slot').first()).toBeVisible()
    await svg.locator('.placement-slot').first().click({ force: true })
    const buildings = svg.locator('g[filter="url(#piece-shadow)"]')
    await expect(buildings).toHaveCount(1)
    await expect(buildings.locator('g[transform*="scale(0.72)"]')).toHaveCount(1)
  })

  test('a port badge tap removes the port with no tool selected', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const tools = page.locator('.tools-panel')
    await openBuild(page)
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    const svg = page.locator('.board-canvas')
    const badges = svg.locator('.port-token')
    const count = await badges.count()
    const badge = badges.first()
    await badge.hover()
    await expect(svg.locator('.placement-hover')).toHaveAttribute('stroke', '#333')
    await badge.click()
    await expect(badges).toHaveCount(count - 1)
    await expect(svg.locator('g[filter="url(#piece-shadow)"]')).toHaveCount(0)
    await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(0)
  })

  test('a solid corner dot previews a settlement and becomes a ring after placing it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await openBuild(page)
    const svg = page.locator('.board-canvas')
    const vertex = hexVertexIds({ q: 0, r: 0 })[0]
    const points = parseVertexId(vertex).map((coord) => axialToPixel(coord, 58))
    const corner = { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
    const color = UNCLAIMED_ROSTER[0].color
    const slot = svg.locator(`.placement-slot[cx="${corner.x}"][cy="${corner.y}"]`)
    await expect(slot).toHaveAttribute('fill', color)
    await expect(slot).toHaveAttribute('r', '3.6')
    const dot = (await slot.boundingBox())!
    const x = dot.x + dot.width / 2
    const y = dot.y + dot.height / 2
    await page.mouse.move(x, y)
    const preview = svg.locator('path.placement-hover')
    await expect(preview).toHaveCount(1)
    await expect(preview).toHaveAttribute('fill', color)
    await expect(slot).toHaveCount(0)
    await expect(svg.locator('circle.placement-hover')).toHaveCount(0)

    await page.mouse.click(x, y)
    const building = svg.locator(`g[fill="${color}"][transform^="translate(${corner.x} ${corner.y})"]`)
    await expect(building).toHaveAttribute('transform', /scale\(0\.72\)/)
    await expect(svg.locator('circle.placement-hover')).toHaveCount(1)
    await expect(preview).toHaveCount(0)
  })

  test('pieces keeps a repeat click on its corner when nearer road slots appear', async ({ page }) => {
    await page.goto('')
    const vertex = hexVertexIds({ q: 0, r: 0 })[0]
    const reserved = new Set([vertex, ...vertexAdjacentVertexIds(vertex)])
    let board: Board = { ...createBoard('standard4'), players: UNCLAIMED_ROSTER, mePlayerId: null }
    for (const player of draftOrder(board)) {
      const slot = buildingSlots(board, player, 'settlement', 'edit').find((ref) => !reserved.has(ref))!
      board = placeBuilding(board, slot, player, 'settlement')
    }
    await seedBoard(page, board)
    await openBuild(page)
    const svg = page.locator('.board-canvas')
    const other = edgeEndpointVertexIds(vertexIncidentEdgeIds(vertex)[0]).find((ref) => ref !== vertex)!
    const [corner, end] = [vertex, other].map((ref) => {
      const points = parseVertexId(ref).map((coord) => axialToPixel(coord, 58))
      return { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
    })
    const slot = svg.locator(`.placement-slot[cx="${corner.x}"][cy="${corner.y}"]`)
    await expect(slot).toBeVisible()
    const dot = (await slot.boundingBox())!
    const scale = await svg.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const view = (element as SVGSVGElement).viewBox.baseVal
      return Math.min(rect.width / view.width, rect.height / view.height)
    })

    // The edge midpoint is eleven units away, but only the corner is actionable on the first click.
    const x = dot.x + dot.width / 2 + (end.x - corner.x) / 58 * 18 * scale
    const y = dot.y + dot.height / 2 + (end.y - corner.y) / 58 * 18 * scale
    const buildings = svg.locator(`g[fill="#c23f38"][transform^="translate(${corner.x} ${corner.y})"]`)
    const hover = svg.locator('.placement-hover')
    await page.mouse.move(x, y)
    await expect(svg.locator('.placement-hover')).toHaveCount(1)
    await page.mouse.click(x, y)
    await expect(buildings).toHaveCount(1)
    await expect(buildings).toHaveAttribute('transform', /scale\(0\.72\)/)
    await page.mouse.click(x, y)
    await expect(buildings).toHaveCount(1)
    await expect(buildings).toHaveAttribute('transform', /scale\(0\.828\)/)
    await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(0)
    await expect(hover).toHaveAttribute('cx', String(corner.x))
    await expect(hover).toHaveAttribute('cy', String(corner.y))
    await page.mouse.click(x, y)
    await expect(buildings).toHaveCount(0)
    await page.mouse.move(0, 0)
    await expect(svg.locator('.placement-hover')).toHaveCount(0)
  })

  test('pieces removes a settlement on the second click during the draft', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await openBuild(page)
    const svg = page.locator('.board-canvas')
    const slot = svg.locator('.placement-slot').first()
    await expect(slot).toBeVisible()
    const dot = (await slot.boundingBox())!
    const x = dot.x + dot.width / 2
    const y = dot.y + dot.height / 2
    const buildings = svg.locator('g[fill="#c23f38"]')
    await page.mouse.click(x, y)
    await expect(buildings).toHaveCount(1)
    await expect(buildings).toHaveAttribute('transform', /scale\(0\.72\)/)
    await expect(svg.locator('g[fill="#c23f38"][transform$="scale(1)"]')).toHaveCount(0)
    await page.mouse.click(x, y)
    await expect(buildings).toHaveCount(0)
    await expect(svg.locator('g[fill="#c23f38"][transform$="scale(1)"]')).toHaveCount(0)
    await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(0)
  })

  test('dragging to a legal corner does not place a piece', async ({ page }) => {
    await page.goto('')
    await openBuild(page)
    const svg = page.locator('.board-canvas')
    const slots = svg.locator('.placement-slot')
    await expect(slots.first()).toBeVisible()
    const closest = await slots.evaluateAll((dots) => dots
      .map((dot, index) => ({ index, x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) }))
      .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0])
    const dot = (await slots.nth(closest.index).boundingBox())!
    const x = dot.x + dot.width / 2
    const y = dot.y + dot.height / 2
    await page.mouse.move(x - 60, y)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 3 })
    await page.mouse.up()
    await expect(svg.locator('g[filter="url(#piece-shadow)"]')).toHaveCount(0)
  })

  test('an empty board offers import and build mode', async ({ page }) => {
    await page.goto('')
    const panel = page.locator('.analysis-panel')
    await expect(panel.locator('h2')).toHaveText('This board is empty')
    await expect(panel.locator('.hint')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
    await panel.getByRole('button', { name: 'Build it by hand' }).click()
    await expect(page.locator('.tools-panel')).toBeVisible()
    await expect(panel).toBeHidden()
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
    await expect(context).toHaveText('Red · Picking 1st and 8th', { useInnerText: true })
    await expect(context).not.toContainText('turn')
    await expect(panel.getByRole('button', { name: 'Step back one pick' })).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Step forward one pick' })).toBeDisabled()

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

    // Chromium briefly resizes to 1x1 during a full-page capture, mounting the
    // phone tree and losing local selection. A viewport shot keeps this tree.
    await page.mouse.move(0, 0)
    await snap(page, 'desktop-selected-card')
    await expect(cards.first()).toHaveClass(/\bcurrent\b/)

    // Clearing drops back to the resting marks, and nothing was placed on the way.
    const buildings = page.locator('.board-canvas g[transform*="scale("]')
    // A road mark draws the same piece inside .road-highlight, so count only placed roads.
    const roads = page.locator('.board-canvas g:not(.road-highlight) > g[transform*="rotate("]')
    await expect(buildings).toHaveCount(0)
    await expect(roads).toHaveCount(0)
    await cards.first().getByRole('button', { name: 'Clear' }).click()
    await page.mouse.move(0, 0)
    await expect(marks).toHaveCount(LISTED_PICKS)
    await expect(cards.first()).not.toHaveClass(/\bcurrent\b/)

    // Place settlement ends the selection and lays one settlement with its setup road.
    await cards.first().locator('.analysis-row-select').click()
    await cards.first().getByRole('button', { name: 'Place settlement' }).click()
    await expect(buildings).toHaveCount(1)
    await expect(roads).toHaveCount(1)
    await expect(panel.locator('.analysis-row.current')).toHaveCount(0)
    await snap(page, 'desktop-placed')
  })

  test('the ledger rows show a claimed rank circle, plain survival and plain text factors', async ({ page }) => {
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

    await expect(panel.locator('.analysis-factors')).toHaveCount(0)
    await panel.locator('.analysis-row-select').first().click()
    await expect(panel.locator('.analysis-factors')).toHaveCount(1)
    await expect(panel.locator('.analysis-factors > span').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    // Survival only renders on a spot the rollouts expect another player may take, and a
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
    await randomize(page)
    await openPlayers(page)
    const panel = page.locator('.player-panel')
    const rows = panel.locator('.roster-row')
    await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)
    await expect(panel.locator('.roster-row.me')).toHaveCount(0)
    // Add player is the heading's + (spec D5); no text row sits under the roster.
    await expect(panel.locator('.panel-heading').getByRole('button', { name: 'Add player' })).toBeVisible()
    await expect(panel.locator('.roster button', { hasText: 'Add player' })).toHaveCount(0)

    await rows.nth(1).click()
    await expect(rows.nth(1)).toHaveClass(/\bme\b/)
    await expect(rows.nth(1).locator('.you-chip')).toBeVisible()
    await expect(rows.nth(0).locator('.you-chip')).toBeHidden()
    await expect(page.locator('.analysis-context .menu-trigger strong')).toHaveText('Blue')

    // The swatch sets the brush and leaves the claim where it is (spec DB3).
    const swatch = rows.nth(2).locator('.swatch')
    await swatch.click()
    await expect(swatch).toHaveAttribute('aria-pressed', 'true')
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

    // The heading's plus is the only way to add, and it stops at six seats.
    const add = panel.getByRole('button', { name: 'Add player' })
    await add.click()
    await add.click()
    await expect(rows).toHaveCount(6)
    await expect(add).toBeDisabled()
  })

  test('claims from the keyboard, and the controls over the claim button still answer', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    await openPlayers(page)
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

    // The swatch keeps its own hit area above the row-wide claim button.
    const swatch = rows.nth(3).locator('.swatch')
    await swatch.click()
    await expect(swatch).toHaveAttribute('aria-pressed', 'true')
    await expect(rows.nth(2)).toHaveClass(/\bme\b/)
  })

  test('the snake draft ribbon sits in Best picks, and a grip drag reseats it', async ({ page }) => {
    await page.goto('')
    await seedUnclaimedRoster(page)
    const panel = page.locator('.player-panel')
    await randomize(page)
    const ribbon = page.locator('.analysis-panel .draft-ribbon')
    const slots = ribbon.locator('.draft-ribbon-slot')

    // Both trees read the draft in Best picks.
    await expect(slots).toHaveCount(UNCLAIMED_ROSTER.length * 2)
    // Nobody is claimed, so no pick is being viewed.
    await expect(ribbon.locator('.draft-ribbon-slot.viewing')).toHaveCount(0)
    await expect(page.locator('.center-column .draft-ribbon')).toHaveCount(0)
    await openPlayers(page)
    await expect(panel).toBeVisible()
    await expect(panel.locator('.draft-section')).toHaveCount(0)
    await expect(panel.locator('.draft-ribbon')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await snap(page, 'desktop-draft-ribbon')

    // Seat order is draft order, so a reorder repaints the ribbon.
    await openPlayers(page)
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
    await openPlayers(page)
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

  test('a library of maps scrolls inside the popover instead of running it off the page', async ({ page }) => {
    await page.goto('')
    await seedSavedMaps(page, 25)
    await openMaps(page)
    const saved = page.locator('.board-list')
    // The seeded maps, plus the blank board the document opened with.
    await expect(saved.locator('.list-row')).toHaveCount(26)

    // The list is bounded, so it scrolls inside the panel and wears the mask
    // over the rows it cuts off (spec D1).
    const list = await saved.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    expect(list.scroll).toBeGreaterThan(list.client)
    await expect(saved).toHaveClass(/fade-bottom/)

    // The Maps popover ends on screen however long the library grows.
    const viewport = page.viewportSize()!
    const mapsBottom = await page.locator('.maps-panel')
      .evaluate((el) => el.getBoundingClientRect().bottom)
    expect(mapsBottom).toBeLessThan(viewport.height)
  })

  test.describe('in a compact two-column window', () => {
    test.use({ viewport: { width: 1040, height: 900 } })

    test('a six-player draft ribbon fits the analysis column', async ({ page }) => {
      const board: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
      await page.goto('')
      await seedBoard(page, { ...board, players: [...board.players, { id: 'p6', name: 'Violet', color: '#7a4fa3' }], mePlayerId: 'p1' })
      const panel = page.locator('.analysis-panel')
      const slots = panel.locator('.draft-ribbon-slot')
      await expect(slots).toHaveCount(12)
      const ribbon = (await panel.locator('.draft-ribbon').boundingBox())!
      const boxes = await slots.evaluateAll((elements) => elements.map((element) => {
        const { left, right, width, height } = element.getBoundingClientRect()
        return { left, right, width, height }
      }))
      expect(boxes[0].left).toBeGreaterThanOrEqual(ribbon.x - 0.5)
      expect(boxes[11].right).toBeLessThanOrEqual(ribbon.x + ribbon.width + 0.5)
      // All twelve circles shrink together to fit the analysis column.
      for (const box of boxes) expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(0.5)
      expect(boxes[0].width).toBeLessThan(30)
      await snap(page, 'desktop-draft-ribbon-six')
    })

    test('leaves the roster name room beside the YOU chip instead of running it under', async ({ page }) => {
      await page.goto('')
      await seedUnclaimedRoster(page)
      await openPlayers(page)
      const rows = page.locator('.player-list .roster-row')
      await expect(rows).toHaveCount(UNCLAIMED_ROSTER.length)
      // One claimed row, so the chip is measured where it is actually drawn.
      await rows.first().click()
      await expect(rows.first()).toHaveClass(/\bme\b/)

      const boxes = await rows.evaluateAll((elements) => elements.map((row) => ({
        cell: row.querySelector('.list-row-main')!.getBoundingClientRect().width,
        nameRight: row.querySelector('.list-row-name')!.getBoundingClientRect().right,
        nameWidth: row.querySelector('.list-row-name')!.getBoundingClientRect().width,
        cellRight: row.querySelector('.list-row-main')!.getBoundingClientRect().right,
        // Only the claimed row draws the chip, inside the name's cell.
        chip: row.querySelector('.you-chip')?.getBoundingClientRect() ?? null,
      })))
      expect(boxes.length).toBeGreaterThan(1)
      expect(boxes.filter((box) => box.chip).length).toBe(1)
      for (const box of boxes) {
        expect(box.cell).toBeGreaterThan(0)
        expect(box.nameWidth).toBeGreaterThan(0)
        if (!box.chip) continue
        expect(box.nameRight).toBeLessThanOrEqual(box.chip.left)
        expect(box.chip.right).toBeLessThanOrEqual(box.cellRight + 0.5)
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
    await openMaps(page)
    await expect(page.locator('.maps-panel')).toBeVisible()
    await seedBoard(page, setHexTile(createBoard('standard4'), { q: 0, r: 0 }, 'ore'))

    // The ribbon opens Best picks on every workspace width (spec DB6).
    await expect(page.locator('.center-column .draft-ribbon')).toHaveCount(0)
    await openPlayers(page)
    await expect(page.locator('.player-panel')).toBeVisible()
    await expect(page.locator('.player-panel .draft-ribbon')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.analysis-panel .draft-ribbon')).toHaveCount(1)
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

test.describe('stacked desktop window', () => {
  test.use({ viewport: { width: 900, height: 700 } })

  test('scrolls the board away rather than over the analysis panel', async ({ page }) => {
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
    await snap(page, 'desktop-stacked')
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
