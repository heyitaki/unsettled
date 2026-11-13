import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createBoard, draftOrder, placeBuilding, setHexTile } from '../src/model/board'
import { LISTED_PICKS } from '../src/ui/restMarks'
import { axialToPixel, edgeEndpointVertexIds, parseVertexId, vertexAdjacentVertexIds, vertexIncidentEdgeIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
import type { Board, VertexId } from '../src/model/types'
import { clientToUnits, IDENTITY } from '../src/ui/boardViewport'
import { buildingSlots } from '../src/ui/placementSlots'
import { contestFixture, seedBoard, seedUnclaimedRoster as seedRoster, UNCLAIMED_ROSTER } from './seed'
import { randomizePhoneBoard } from './phoneBoardTools'

/**
 * The phone shell, in the one emulation that makes both `(max-width: 760px)`
 * and `(pointer: coarse)` match in the installed Chromium. Never spread a `devices[...]` preset here:
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

test('wraps contest notes below the tiles and draws rings when a row is tapped', async ({ page }) => {
  const name = 'Blue'.repeat(15)
  expect(name).toHaveLength(60)
  const { board, contests, notes } = await contestFixture(name)
  await open(page)
  await seedBoard(page, board)
  const rows = page.locator('.analysis-row-select')
  await expect(rows).toHaveCount(LISTED_PICKS)
  await expect(rows.locator('.analysis-contest')).toHaveText(notes)
  const boxes = await rows.evaluateAll((buttons) => buttons.map((button) => {
    const row = button.getBoundingClientRect()
    const note = button.querySelector('.analysis-contest')!.getBoundingClientRect()
    const tiles = button.querySelector(':scope > .spot-tiles')!.getBoundingClientRect()
    const body = button.querySelector('.analysis-row-body')!.getBoundingClientRect()
    return {
      inside: note.left >= row.left && note.right <= row.right && note.top >= row.top && note.bottom <= row.bottom,
      below: note.top >= tiles.bottom && note.top >= body.bottom,
      noteHeight: note.height,
      scrollWidth: button.scrollWidth, clientWidth: button.clientWidth,
    }
  }))
  for (const box of boxes) {
    expect(box.inside).toBe(true)
    expect(box.below).toBe(true)
    expect(box.noteHeight).toBeGreaterThan(11 * 1.35)
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  }
  await rows.first().tap()
  await expect(page.locator('.vertex-ring')).toHaveCount(contests[0].spots.length)
  for (const ring of await page.locator('.vertex-ring').all()) {
    await expect(ring).toHaveAttribute('stroke', board.players[1].color)
  }
  await expect(rows.first().locator('.analysis-factors')).toBeVisible()
  expect(await rows.first().evaluate((row) => {
    const note = row.querySelector('.analysis-contest')!.getBoundingClientRect()
    const factors = row.querySelector('.analysis-factors')!.getBoundingClientRect()
    return note.bottom <= factors.top
  })).toBe(true)
})

test('the header names the active board and nothing of the desktop chrome mounts', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Board 1' })).toBeVisible()
  await expect(page.locator('.head-title')).toHaveText('Board 1')
  for (const selector of ['.workspace', '.board-tabs', '.site-header', 'footer']) {
    await expect(page.locator(selector)).toHaveCount(0)
  }
  await snap(page, 'header')
})

test('the build heading holds history, with board actions in the tools and export in Maps', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const tools = page.locator('.phone-build')
  const heading = tools.locator('.panel-heading')
  expect(await heading.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
    .toEqual(['Undo', 'Redo'])
  await expect(heading.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(tools.getByRole('button', { name: 'Clear board', exact: true })).toBeVisible()
  await snap(page, 'build-actions')
  await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
  await tools.getByRole('button', { name: 'Done' }).click()
  // The board is still the one just dealt, so a re-roll from a new build session does not ask.
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(tools.locator('.tool-count').first()).toHaveText('19/19')
  await tools.getByRole('button', { name: 'Done' }).click()
  await page.locator('.head-title').click()
  await page.getByRole('button', { name: 'Import and export files' }).click()
  await expect(page.getByRole('menuitem', { name: 'Export JSON' })).toBeVisible()
})

test('randomizing a board that has something on it asks first, and can deal a new board instead', async ({ page }) => {
  await open(page)
  const randomize = async () => {
    await page.getByRole('button', { name: 'Edit the board' }).click()
    await page.locator('.phone-build').getByRole('button', { name: 'Randomize', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Randomize this board?' })
  await randomize()
  await expect(dialog).toHaveCount(0)
  // Reopened, the board is a saved one and no longer the deal just made.
  await page.reload()
  await randomize()
  await expect(dialog).toBeVisible()
  // A viewport capture: the dialog sits in the top layer over the page.
  await page.screenshot({ path: 'test-results/phone/randomize-confirm.png' })
  await dialog.getByRole('button', { name: 'New board' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.head-title')).toHaveText('Board 2')
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

test('the analysis block opens with a ribbon of every pick and the sea frame takes the board\'s proportions', async ({ page }) => {
  await open(page)
  await randomizePhoneBoard(page)
  const players = await page.locator('.head-dot').count()
  const slots = page.locator('.phone-analysis .draft-ribbon-slot')
  await expect(slots).toHaveCount(players * 2)
  await expect(slots.first()).toHaveClass(/\bviewing\b/)
  const canvas = page.locator('.board-canvas')
  const frame = await canvas.boundingBox()
  expect(frame).not.toBeNull()
  // Square for content wider than tall, the content's own ratio otherwise (mobile spec S3).
  const [, , width, height] = (await canvas.getAttribute('viewBox'))!.split(' ').map(Number)
  expect(Math.abs(frame!.height - frame!.width / Math.min(1, width / height))).toBeLessThanOrEqual(1)
  await snap(page, 'ribbon-board')
})

test('ribbon dots claim a player and the heading steps back and forward one pick', async ({ page }) => {
  await open(page)
  let board = setHexTile({ ...createBoard('standard4'), players: UNCLAIMED_ROSTER, mePlayerId: 'p1' }, { q: 0, r: 0 }, 'ore')
  const vertices = boardGrid(board.layout).vertexIds
  board = placeBuilding(board, vertices[0], 'p1', 'settlement')
  board = placeBuilding(board, vertices[10], 'p2', 'settlement')
  await seedBoard(page, board)

  const panel = page.locator('.phone-analysis')
  const slots = panel.locator('.draft-ribbon-slot')
  await panel.getByRole('button', { name: 'Pick 2: Blue', exact: true }).click()
  await expect(panel.locator('.analysis-context')).toHaveText('Blue · Picking 2nd and 7th', { useInnerText: true })
  await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'false')
  await expect(slots.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(slots.nth(6)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('.draft-ribbon-slot[aria-pressed="true"]')).toHaveCount(2)

  const back = panel.getByRole('button', { name: 'Step back one pick' })
  const forward = panel.getByRole('button', { name: 'Step forward one pick' })
  for (const button of [back, forward]) {
    const box = (await button.boundingBox())!
    expect(box.width).toBe(36)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  const blue = page.locator('.board-canvas g[fill="#3063ba"]')
  await expect(blue).toHaveCount(1)
  const placement = await blue.getAttribute('transform')
  await expect(forward).toBeDisabled()
  await back.click()
  await expect(blue).toHaveCount(0)
  await panel.getByRole('button', { name: 'Pick 1: Red', exact: true }).click()
  await expect(forward).toBeEnabled()
  await forward.click()
  await expect(blue).toHaveCount(1)
  await expect(blue).toHaveAttribute('transform', placement!)
  await expect(forward).toBeDisabled()
  await expect(panel.locator('.analysis-context .menu-trigger strong')).toHaveText('Red')
})

test('the six-player layout gets a taller frame from an unmoved top with no caption', async ({ page }) => {
  await open(page)
  const frameTop = (await page.locator('.board-canvas').boundingBox())!.y
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.getByRole('button', { name: '5–6 players', exact: true }).click()
  await expect(page.getByRole('button', { name: '5–6 players', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.phone-build').getByRole('button', { name: 'Done' }).click()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  const frame = await page.locator('.board-canvas').boundingBox()
  expect(frame!.height).toBeGreaterThan(frame!.width)
  expect((await page.locator('.board-canvas').boundingBox())!.y).toBe(frameTop)
  await expect(page.locator('.board-status')).toHaveCount(0)
  await snap(page, 'six-player-frame')
})

/** The shared seed, plus the wait for the reloaded shell to show the new roster. */
async function seedUnclaimedRoster(page: Page) {
  await seedRoster(page)
  await expect(page.locator('.head-dot')).toHaveCount(UNCLAIMED_ROSTER.length)
}

test('an empty board offers the two ways to fill it', async ({ page }) => {
  await open(page)
  const block = page.locator('.phone-analysis')
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
  await expect(page.locator('.head-title')).toHaveText('board-endgame-pieces', { timeout: 30_000 })
  // The fixture is a game past its draft, so the block is the move adviser.
  await expect(block.getByRole('heading', { name: 'Best moves', exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.issue-list button.warning')).not.toHaveCount(0)
  await snap(page, 'import-issues')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
  // Emptying the board again must not bring the dialog back on its own.
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.locator('.phone-build').getByRole('button', { name: 'Clear board', exact: true }).click()
  await page.getByRole('dialog', { name: 'Clear this board?' }).getByRole('button', { name: 'Clear board', exact: true }).click()
  await page.locator('.phone-build').getByRole('button', { name: 'Done' }).click()
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await expect(dialog).toHaveCount(0)
})

test('a filled board asks who you are, and a tapped swatch claims that seat', async ({ page }) => {
  await open(page)
  await seedUnclaimedRoster(page)
  const block = page.locator('.phone-analysis')
  await expect(block.locator('h2')).toHaveText('This board is empty')
  await randomizePhoneBoard(page)
  await expect(block.locator('h2')).toHaveText('Best picks')
  await expect(block.locator('.analysis-context')).toHaveCount(0)
  const swatches = block.locator('.claim-row button')
  await expect(swatches).toHaveCount(4)
  await snap(page, 'claim-row')
  await swatches.first().click()
  await expect(block.locator('.analysis-context')).toHaveText('Red · Picking 1st and 8th', { useInnerText: true })
  await expect(page.locator('.head-dot').first()).toHaveClass(/\bme\b/)
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
    await randomizePhoneBoard(page)
    const block = page.locator('.phone-analysis')
    await expect(block.locator('.analysis-context')).toHaveText('aki · Picking 1st and 2nd', { useInnerText: true })
    const marks = page.locator('.vertex-highlight')
    await expect(marks).toHaveCount(5)
    await expect(page.locator('.vertex-highlight.faded')).toHaveCount(0)
    const myColor = await page.locator('.head-dot.me').evaluate((dot) => getComputedStyle(dot).backgroundColor)
    await expect(marks.first()).toHaveCSS('fill', myColor)
    await snap(page, 'rest-marks')

    const cards = block.locator('.analysis-row-select')
    await expect(cards).toHaveCount(5)
    // The factors open with the selection, as on the desktop.
    await expect(block.locator('.analysis-factors')).toHaveCount(0)
    await page.evaluate(() => window.scrollBy(0, 2000))
    const scrolledBoard = (await page.locator('.board-canvas').boundingBox())!
    const header = (await page.locator('.phone-head').boundingBox())!
    expect(scrolledBoard.y + scrolledBoard.height).toBeLessThan(header.y + header.height + 120)
    await cards.last().click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(block.locator('.analysis-factors')).toHaveCount(1)
    await expect(marks).toHaveCount(2)
    await expect(page.locator('.vertex-highlight.faded')).toHaveCount(1)
    await snap(page, 'selected-card')

    await page.evaluate(() => window.scrollTo(0, 100))
    const first = (await cards.first().boundingBox())!
    expect(first.y + first.height).toBeLessThan(page.viewportSize()!.height)
    await cards.first().click()
    await expect(block.locator('.analysis-row.current .analysis-rank')).toHaveText('1')
    expect(await page.evaluate(() => window.scrollY)).toBe(100)
  })
})

test.describe('build mode', () => {
  test('entering build mode arms piece placing without a tool button', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Edit the board' }).click()
    const tools = page.locator('.phone-build')
    await expect(tools.locator('.structure-grid button')).toHaveText(['Randomize', 'Clear pieces', 'Clear board'])
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    await expect(tools.locator('.tool-hint')).toBeVisible()
    const svg = page.locator('.board-canvas')
    await expect(svg.locator('.placement-slot').first()).toBeVisible()
    await svg.locator('.placement-slot').first().tap({ force: true })
    const buildings = svg.locator('g[filter="url(#piece-shadow)"]')
    await expect(buildings).toHaveCount(1)
    await expect(buildings.locator('g[transform*="scale(0.8)"]')).toHaveCount(1)
  })

  test('the pencil swaps in the tools without moving the board, a layout switch stays in build mode, and Cancel restores the board', async ({ page }) => {
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
    await expect(tools.locator('.tool-label')).toHaveText(['Layout', 'Terrain0/19', 'Number token0/19', 'Board'])
    expect((await page.locator('.board-canvas').boundingBox())!.y).toBe(boardTop)
    const sideways = await page.locator('.phone-page').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((el) => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth)
        .map((el) => el.className))
    expect(sideways).toEqual(['tool-grid terrain-grid', 'token-tools'])
    const actions = tools.locator('.structure-grid')
    const row = await actions.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    expect(row.scroll).toBeLessThanOrEqual(row.client)
    const block = (await tools.locator('.block-inner').boundingBox())!
    const buttons = await actions.locator('button').evaluateAll((elements) => elements.map((element) => {
      const { left, right, top } = element.getBoundingClientRect()
      return { left, right, top }
    }))
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button.top).toBe(buttons[0].top)
      expect(button.left).toBeGreaterThanOrEqual(block.x)
      expect(button.right).toBeLessThanOrEqual(block.x + block.width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await snap(page, 'build-mode')

    await tools.getByRole('button', { name: '5–6 players', exact: true }).click()
    await expect(tools.getByRole('button', { name: '5–6 players', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(pencil).toHaveAttribute('aria-pressed', 'true')
    await expect(tools).toBeVisible()
    await expect(analysis).toHaveCount(0)
    await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
    await expect(tools.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await tools.getByRole('button', { name: 'Cancel' }).click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    await expect(tools).toHaveCount(0)
    await expect(analysis.locator('h2')).toHaveText('This board is empty')
    await pencil.click()
    await expect(tools.getByRole('button', { name: '4 players', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await tools.getByRole('button', { name: 'Done' }).click()
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
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    await tools.getByRole('button', { name: 'wood' }).click()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveText('wood')
    await tools.getByRole('button', { name: 'Randomize', exact: true }).click()
    await tools.getByRole('button', { name: 'Done' }).click()
    await expect(pencil).toHaveAttribute('aria-pressed', 'false')
    const analysis = page.locator('.phone-analysis')
    await expect(analysis.locator('h2')).toHaveText('Best picks')
    await expect(analysis.locator('.analysis-context')).toHaveText('aki · Picking 1st and 2nd', { useInnerText: true })
    await pencil.click()
    await expect(tools.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await expect(tools.locator('button.selected:not(.layout-grid button)')).toHaveCount(0)
    await snap(page, 'build-done')
  })

  test('the header dots pick whose piece the board places', async ({ page }) => {
    await open(page)
    await seedUnclaimedRoster(page)
    await randomizePhoneBoard(page)
    await page.getByRole('button', { name: 'Edit the board' }).click()
    const players = page.getByRole('button', { name: /^Place pieces for / })
    await expect(players).toHaveCount(4)
    expect(await players.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
      .toEqual(['Place pieces for Red', 'Place pieces for Blue', 'Place pieces for Orange', 'Place pieces for White'])
    await expect(page.getByRole('button', { name: 'Place pieces for Red', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const slots = page.locator('.placement-slot')
    await expect(slots.first()).toHaveAttribute('fill', '#c23f38')
    await page.getByRole('button', { name: 'Place pieces for Blue', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Place pieces for Blue', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.head-dots [aria-pressed="true"]')).toHaveCount(1)
    await expect(slots.first()).toHaveAttribute('fill', '#3063ba')
    await page.evaluate(() => window.scrollTo(0, 0))
    // The dots take no pointer events: the click lands on the board at the dot's centre.
    await slots.first().click({ force: true })
    await expect(page.locator('.board-canvas g[fill="#3063ba"]')).toHaveCount(1)
    await expect(page.locator('.board-canvas g[fill="#c23f38"]')).toHaveCount(0)
    // Buttons cross-fade over 160ms, so an immediate capture shows two pressed.
    await page.waitForTimeout(400)
    await snap(page, 'build-player')
  })
})

test('outside build mode a draft tap places a settlement only on a Best picks circle', async ({ page }) => {
  await open(page)
  const player = UNCLAIMED_ROSTER[0]
  const board: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
  await seedBoard(page, { ...board, players: UNCLAIMED_ROSTER, mePlayerId: player.id })
  await expect(page.getByRole('button', { name: 'Edit the board' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.phone-build')).toHaveCount(0)
  const svg = page.locator('.board-canvas')
  const marks = svg.locator('.vertex-highlight')
  await expect(marks).toHaveCount(LISTED_PICKS, { timeout: 60_000 })
  await expect(svg.locator('.placement-slot')).toHaveCount(0)
  const marked = await marks.evaluateAll((marks) => marks.map((mark) => ({ x: Number(mark.getAttribute('cx')), y: Number(mark.getAttribute('cy')) })))
  const tapCorner = async (corner: { x: number; y: number }) => {
    const point = await svg.evaluate((element, corner) => {
      const point = new DOMPoint(corner.x, corner.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
      return { x: point.x, y: point.y }
    }, corner)
    await page.touchscreen.tap(point.x, point.y)
  }
  const buildings = svg.locator('g[filter="url(#piece-shadow)"] > g, g[filter="url(#piece-highlight)"] > g')
  // A legal corner out of reach of every circle: nothing is placed there.
  const bare = buildingSlots(board, player.id, 'settlement', 'edit').map((ref) => {
    const points = parseVertexId(ref).map((coord) => axialToPixel(coord, 58))
    return { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
  }).find((corner) => marked.every((mark) => Math.hypot(mark.x - corner.x, mark.y - corner.y) > 58))!
  await tapCorner(bare)
  const corner = marked[0]
  await tapCorner(corner)
  await expect(buildings).toHaveCount(1)
  await expect(buildings).toHaveAttribute('fill', player.color)
  await expect(buildings).toHaveAttribute('transform', `translate(${corner.x} ${corner.y}) scale(0.8)`)
  // Away from the circles a double tap still zooms, and places nothing.
  await tapCorner(bare)
  await tapCorner(bare)
  await expect(page.locator('.board-zoom')).toContainText('2.5×')
  await expect(buildings).toHaveCount(1)
})

test('double tapping the board outside build mode still zooms', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Edit the board' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.phone-build')).toHaveCount(0)
  const svg = page.locator('.board-canvas')
  const before = (await svg.getAttribute('viewBox'))!
  const box = (await svg.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.touchscreen.tap(x, y)
  await page.touchscreen.tap(x, y)
  await expect(svg).not.toHaveAttribute('viewBox', before)
  await expect(page.locator('.board-zoom')).toContainText('2.5×')
  await expect(svg.locator('g[filter="url(#piece-shadow)"]')).toHaveCount(0)
  await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(0)
})

test('a pinch and a one-finger pan follow fingers that land on the hexes', async ({ page }) => {
  await open(page)
  const svg = page.locator('.board-canvas')
  const box = (await svg.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, index) => ({ ...point, id: index + 1 })) })
  const y = box.y + box.height / 2
  const left = box.x + box.width * 0.4
  const right = box.x + box.width * 0.6
  // A real first finger moves before the second lands, which settles its implicit capture on the hex under it.
  await touch('touchStart', [{ x: left, y }])
  await touch('touchMove', [{ x: left - 2, y }])
  await touch('touchStart', [{ x: left - 2, y }, { x: right, y }])
  for (let step = 1; step <= 5; step += 1) await touch('touchMove', [{ x: left - 2 - step * 8, y }, { x: right + step * 8, y }])
  await touch('touchEnd', [])
  // The spread roughly doubles; a pinch that loses a finger stops at its first frame, near 1.1×.
  await expect.poll(async () => parseFloat((await page.locator('.board-zoom').textContent())!)).toBeGreaterThan(1.5)
  const zoomed = (await svg.getAttribute('viewBox'))!
  await touch('touchStart', [{ x: right, y }])
  await touch('touchMove', [{ x: right - 20, y }])
  await expect(svg).not.toHaveAttribute('viewBox', zoomed)
  // The pan has taken the pointer for the svg by now, and has to outlive that hand-over.
  const started = (await svg.getAttribute('viewBox'))!
  await touch('touchMove', [{ x: right - 40, y }])
  await touch('touchMove', [{ x: right - 60, y }])
  await touch('touchEnd', [])
  await expect(svg).not.toHaveAttribute('viewBox', started)
})

test('pieces maps a coastal tap through the padded svg content box', async ({ page }) => {
  await open(page)
  const vertex: VertexId = 'v:-3,1;-2,0;-2,1'
  const grid = boardGrid('standard4')
  const inland = vertexIncidentEdgeIds(vertex).find((ref) => grid.edgeIds.includes(ref) && !grid.coastalEdgeIds.includes(ref))!
  const other = edgeEndpointVertexIds(inland).find((ref) => ref !== vertex)!
  const [corner, end] = [vertex, other].map((ref) => {
    const points = parseVertexId(ref).map((coord) => axialToPixel(coord, 58))
    return { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
  })
  const reserved = new Set([vertex, ...vertexAdjacentVertexIds(vertex)])
  let board: Board = { ...createBoard('standard4'), players: UNCLAIMED_ROSTER, mePlayerId: null }
  for (const player of draftOrder(board)) {
    const slot = buildingSlots(board, player, 'settlement', 'edit').find((ref) => !reserved.has(ref))!
    board = placeBuilding(board, slot, player, 'settlement')
  }
  await seedBoard(page, board)
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  await svg.locator(`.placement-slot[cx="${corner.x}"][cy="${corner.y}"]`).tap({ force: true })
  const building = svg.locator(`g[fill="#c23f38"][transform^="translate(${corner.x} ${corner.y})"]`)
  await expect(building).toHaveAttribute('transform', /scale\(0\.8\)/)
  const { box, content, view } = await svg.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const left = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
    const right = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth)
    const top = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)
    const bottom = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)
    const view = (element as SVGSVGElement).viewBox.baseVal
    return {
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      content: { x: rect.x + left, y: rect.y + top, width: rect.width - left - right, height: rect.height - top - bottom },
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
    }
  })
  const point = { x: corner.x + (end.x - corner.x) / 58 * 12, y: corner.y + (end.y - corner.y) / 58 * 12 }
  const scale = Math.min(content.width / view.width, content.height / view.height)
  const tap = {
    x: content.x + (content.width - view.width * scale) / 2 + (point.x - view.x) * scale,
    y: content.y + (content.height - view.height * scale) / 2 + (point.y - view.y) * scale,
  }

  // The border-box mapping crosses the road's halfway boundary at this coastal corner.
  const wrong = clientToUnits(tap, box, view, IDENTITY)
  expect(Math.hypot(wrong.x - (corner.x + end.x) / 2, wrong.y - (corner.y + end.y) / 2))
    .toBeLessThan(Math.hypot(wrong.x - corner.x, wrong.y - corner.y))
  await page.touchscreen.tap(tap.x, tap.y)
  await expect(building).toHaveAttribute('transform', /scale\(0\.92\)/)
  await expect(svg.locator('g[transform*="rotate("]')).toHaveCount(0)
})

test.describe('maps screen', () => {
  test('the title opens Maps, where boards are added, selected, renamed, deleted, saved and sorted', async ({ page }) => {
    await open(page)
    const title = page.locator('.head-title')
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const rows = screen.locator('.board-list .list-row')
    await title.click()
    await expect(screen).toBeVisible()
    await expect(screen.locator('.phone-overlay-title')).toHaveText('Maps')
    await expect(screen.getByRole('button', { name: 'Import screenshot' })).toBeVisible()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveClass(/\bcurrent\b/)
    // A blank board has nothing saved, so it carries no timestamp.
    await expect(rows.first()).toBeVisible()
    await expect(rows.first().locator('.list-row-meta')).toHaveCount(0)
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
    await randomizePhoneBoard(page)
    await title.click()
    // The edit saved the board, so its row is the same row, now stamped and
    // listed after the blank board that has no map yet: one list, not two.
    await expect(rows.locator('.list-row-name')).toHaveText(['Board 2', 'Thursday'])
    await expect(rows.nth(1)).toHaveClass(/\bcurrent\b/)
    await expect(rows.nth(1).locator('.list-row-meta')).toHaveText('just now')
    await expect(screen.locator('.group-label')).toContainText('Boards (2)')

    await screen.getByRole('button', { name: 'Delete Board 2', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: /Sort boards/ }).click()
    await expect(page.getByRole('option')).toHaveText(['Last modified', 'Created', 'Last opened', 'Name'])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(screen).toBeVisible()

    await screen.getByRole('button', { name: 'Import and export files' }).click()
    const menu = page.getByRole('menu', { name: 'Import and export files' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Import JSON', 'Export JSON', 'Back up library', 'Restore library backup'])
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
    await page.locator('.head-title').click()
    await screen.getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Board 1' })
    await field.fill('Discarded')
    await field.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(screen).toBeVisible()
    await expect(screen.locator('.board-list .list-row-name')).toHaveText('Board 1')
    await expect(page.locator('.head-title')).toHaveText('Board 1')
  })

  test('renaming a saved map from its row retitles the board linked to it', async ({ page }) => {
    await open(page)
    await randomizePhoneBoard(page)
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const rows = screen.locator('.board-list .list-row')
    await page.locator('.head-title').click()
    // One board, one row, even now that it is saved.
    await expect(rows).toHaveCount(1)
    await expect(rows.first().locator('.list-row-meta')).toHaveText('just now')
    await rows.first().getByRole('button', { name: 'Rename Board 1', exact: true }).click()
    const field = screen.getByRole('textbox', { name: 'Rename Board 1' })
    await field.fill('Friday')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(rows.locator('.list-row-name')).toHaveText(['Friday'])
    await expect(page.locator('.head-title')).toHaveText('Friday')
    await expect(screen).toBeVisible()
  })

  test('only an import that lands closes the screen', async ({ page }) => {
    await open(page)
    const screen = page.getByRole('dialog', { name: 'Maps' })
    const importDialog = page.getByRole('dialog', { name: 'Import screenshot' })
    await page.locator('.head-title').click()
    // Dismissed with nothing imported: the screen stays.
    await screen.getByRole('button', { name: 'Import screenshot' }).click()
    await expect(importDialog).toBeVisible()
    await importDialog.getByRole('button', { name: 'Done' }).click()
    await expect(importDialog).toHaveCount(0)
    await expect(screen).toBeVisible()
    // Deleting the current board afterwards changes the active tab, which is
    // not an import either.
    await screen.getByRole('button', { name: 'New board' }).click()
    await expect(screen).toHaveCount(0)
    await page.locator('.head-title').click()
    await screen.getByRole('button', { name: 'Delete Board 2', exact: true }).click()
    await expect(screen.locator('.board-list .list-row')).toHaveCount(1)
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
    await importDialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/settled-3p-pick-cards.png'))
    await expect(page.locator('.head-title')).toHaveText('settled-3p-pick-cards', { timeout: 30_000 })
    await expect(screen).toHaveCount(0)
    await expect(importDialog).toHaveCount(0)
  })
})

test.describe('players screen', () => {
  test('the dots open Players, where a row claims, a name renames, and a grip drag reseats the draft', async ({ page }) => {
    await open(page)
    await seedUnclaimedRoster(page)
    await randomizePhoneBoard(page)
    const context = page.locator('.phone-analysis .analysis-context')
    const screen = page.getByRole('dialog', { name: 'Players' })
    const rows = screen.locator('.roster-row')
    await page.getByRole('button', { name: 'Players', exact: true }).click()
    await expect(screen).toBeVisible()
    await expect(screen.locator('.phone-overlay-title')).toHaveText('Players')
    // Back and Add player only: the Players screen has no dots menu.
    await expect(screen.locator('.phone-overlay-head').getByRole('button', { name: 'Add player' })).toBeVisible()
    await expect(screen.locator('.phone-overlay-head button')).toHaveCount(2)
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
    await expect(page.locator('.head-dot').nth(1)).toHaveClass(/\bme\b/)
    await expect(context).toHaveText(/Picking 2nd and 7th/)

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
    // The resting row slides a whole slot down: the distance is measured off the
    // neighbour it stands in for, so it is read here rather than named. Polled
    // because the row eases into place over its own transition.
    await expect.poll(() => rows.nth(0).evaluate((el) =>
      new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeGreaterThan(top.height)
    await snap(page, 'players-drag')
    await page.mouse.up()
    await expect(rows.locator('.list-row-name')).toHaveText(['White', 'Red', 'Bea', 'Orange'])
    await expect(rows.nth(0)).not.toHaveClass(/\bdragging\b/)
    await expect(screen.locator('.roster-trash')).toHaveCount(0)
    await expect(rows.nth(2)).toHaveClass(/\bme\b/)
    await expect(page.locator('.draft-ribbon-slot').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(context).toHaveText(/Picking 3rd and 6th/)
    await expect(screen.locator('.draft-grid-name').first()).toHaveText('White')
    await snap(page, 'players-reordered')

    await screen.getByRole('button', { name: 'Add player' }).click()
    await expect(rows).toHaveCount(5)
    await expect(rows.last().locator('.list-row-name')).toHaveText('Player 5')
    await expect(page.locator('.head-dot')).toHaveCount(5)
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
    await expect(page.locator('.head-dot')).toHaveCount(3)
  })
})
