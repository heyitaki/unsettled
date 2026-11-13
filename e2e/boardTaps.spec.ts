import { expect, test, type Page } from '@playwright/test'
import { createBoard, setHexTile, setRobber } from '../src/model/board'
import { axialToPixel } from '../src/model/coords'
import { BLANK_TILE_COLOR, TILE_COLORS } from '../src/ui/colors'
import { seedBoard } from './seed'

test.use({ viewport: { width: 1280, height: 900 } })

async function screenPoint(page: Page, point: { x: number; y: number }) {
  return page.locator('.board-canvas').evaluate((element, point) => {
    const screen = new DOMPoint(point.x, point.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  }, point)
}

async function clickPoint(page: Page, point: { x: number; y: number }) {
  const screen = await screenPoint(page, point)
  await page.mouse.click(screen.x, screen.y)
}

test('a tap on a tile centre moves the robber there', async ({ page }) => {
  await page.goto('')
  const coord = { q: 0, r: 0 }
  const other = { q: 1, r: 0 }
  await seedBoard(page, setHexTile(setHexTile(createBoard('standard4'), coord, 'wood'), other, 'ore'))
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  const robber = svg.locator('g:has(> circle[fill="#1c1c1c"])')
  await expect(robber).toHaveCount(0)
  const point = axialToPixel(coord, 58)
  await clickPoint(page, point)
  await expect(robber).toHaveAttribute('transform', `translate(${point.x} ${point.y})`)
  const hover = await screenPoint(page, axialToPixel(other, 58))
  await page.mouse.move(hover.x, hover.y)
  await expect(svg.locator('.placement-hover')).toHaveCount(0)
})

test('a tap on a tile centre before pressing the pencil leaves the robber in place', async ({ page }) => {
  await page.goto('')
  const from = { q: 0, r: 0 }
  const to = { q: 1, r: 0 }
  await seedBoard(page, setRobber(setHexTile(setHexTile(createBoard('standard4'), from, 'wood'), to, 'ore'), from))
  const pencil = page.getByRole('button', { name: 'Edit the board' })
  await expect(pencil).toHaveAttribute('aria-pressed', 'false')
  const robber = page.locator('.board-canvas g:has(> circle[fill="#1c1c1c"])')
  const point = axialToPixel(from, 58)
  await expect(robber).toHaveAttribute('transform', `translate(${point.x} ${point.y})`)
  await clickPoint(page, axialToPixel(to, 58))
  await expect(robber).toHaveAttribute('transform', `translate(${point.x} ${point.y})`)
})

test('a tap on a tile with its own terrain selected blanks it and removes its robber', async ({ page }) => {
  await page.goto('')
  const coord = { q: 0, r: 0 }
  await seedBoard(page, setRobber(setHexTile(createBoard('standard4'), coord, 'wood'), coord))
  await page.getByRole('button', { name: 'Edit the board' }).click()
  await page.locator('.tools-panel').getByRole('button', { name: 'wood', exact: true }).click()
  const svg = page.locator('.board-canvas')
  await expect(svg.locator(`polygon[fill="${BLANK_TILE_COLOR}"]`)).toHaveCount(18)
  await expect(svg.locator('circle[fill="#1c1c1c"]')).toHaveCount(1)
  await clickPoint(page, axialToPixel(coord, 58))
  await expect(svg.locator(`polygon[fill="${BLANK_TILE_COLOR}"]`)).toHaveCount(19)
  await expect(svg.locator('circle[fill="#1c1c1c"]')).toHaveCount(0)
})

async function portPoint(page: Page, index: number) {
  return page.locator('.board-canvas .port-token').nth(index).evaluate((token) => ({
    x: Number(token.getAttribute('cx')),
    y: Number(token.getAttribute('cy')),
  }))
}

test('with no tool a port tap removes the port and a tap on its empty spot adds a 3:1 port', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  const badges = svg.locator('.board-port')
  const generic = svg.locator('.board-port[data-resource="any"]')
  const count = await badges.count()
  const genericCount = await generic.count()
  const wasGeneric = (await badges.first().getAttribute('data-resource')) === 'any'
  const point = await portPoint(page, 0)
  await clickPoint(page, point)
  await expect(badges).toHaveCount(count - 1)
  await clickPoint(page, point)
  await expect(badges).toHaveCount(count)
  await expect(generic).toHaveCount(wasGeneric ? genericCount : genericCount + 1)
})

test('a picked terrain turns a tapped port 2:1 for it and a second tap makes it 3:1 again', async ({ page }) => {
  await page.goto('')
  const board = createBoard('standard4')
  await seedBoard(page, { ports: board.ports.map((port) => ({ ...port, resource: null, rate: 3 })) })
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  const badge = svg.locator('.board-port').first()
  const point = await portPoint(page, 0)
  const tools = page.locator('.tools-panel')
  await tools.getByRole('button', { name: 'wheat', exact: true }).click()
  await clickPoint(page, point)
  await expect(badge).toHaveAttribute('data-rate', '2')
  await expect(badge.locator('.port-token')).toHaveAttribute('fill', TILE_COLORS.wheat)
  await expect(svg.locator('.board-port[data-rate="2"]')).toHaveCount(1)
  await clickPoint(page, point)
  await expect(badge).toHaveAttribute('data-rate', '3')
  await expect(svg.locator('.board-port[data-rate="2"]')).toHaveCount(0)
  await clickPoint(page, point)
  await expect(badge.locator('.port-token')).toHaveAttribute('fill', TILE_COLORS.wheat)
  await tools.getByRole('button', { name: 'ore', exact: true }).click()
  await clickPoint(page, point)
  await expect(badge).toHaveAttribute('data-rate', '2')
  await expect(badge.locator('.port-token')).toHaveAttribute('fill', TILE_COLORS.ore)
  await expect(svg.locator('.board-port')).toHaveCount(board.ports.length)
})

test('a picked terrain puts a 2:1 port on an empty coastal spot and still sets tiles', async ({ page }) => {
  await page.goto('')
  const board = createBoard('standard4')
  await seedBoard(page, { ports: board.ports.slice(1) })
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  await page.locator('.tools-panel').getByRole('button', { name: 'brick', exact: true }).click()
  const slots = svg.locator('.placement-slot')
  await expect(slots.first()).toBeVisible()
  await slots.first().click({ force: true })
  await expect(svg.locator('.board-port')).toHaveCount(board.ports.length)
  await expect(svg.locator(`.port-token[fill="${TILE_COLORS.brick}"]`)).toHaveCount(
    board.ports.slice(1).filter((port) => port.resource === 'brick').length + 1)
  const tiles = svg.locator(`polygon[fill="${TILE_COLORS.brick}"]`)
  const tileCount = await tiles.count()
  await clickPoint(page, axialToPixel({ q: 0, r: 0 }, 58))
  await expect(tiles).toHaveCount(tileCount + 1)
})

test('a terrain click that drifts inside a hex still paints it', async ({ page }) => {
  await page.goto('')
  await seedBoard(page, createBoard('standard4'))
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  await page.locator('.tools-panel').getByRole('button', { name: 'wheat', exact: true }).click()
  const tiles = svg.locator(`polygon[fill="${TILE_COLORS.wheat}"]`)
  await expect(tiles).toHaveCount(0)
  const centre = await screenPoint(page, axialToPixel({ q: 0, r: 0 }, 58))
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 14, centre.y, { steps: 4 })
  await page.mouse.up()
  await expect(tiles).toHaveCount(1)
})

test('desert and number tools leave ports alone', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const svg = page.locator('.board-canvas')
  const count = await svg.locator('.board-port').count()
  const point = await portPoint(page, 0)
  const first = svg.locator('.board-port').first()
  const before = await first.innerHTML()
  const tools = page.locator('.tools-panel')
  await tools.getByRole('button', { name: 'desert', exact: true }).click()
  await expect(svg.locator('.placement-slot')).toHaveCount(0)
  await clickPoint(page, point)
  await tools.getByRole('button', { name: '6', exact: true }).click()
  await clickPoint(page, point)
  await expect(svg.locator('.board-port')).toHaveCount(count)
  expect(await first.innerHTML()).toBe(before)
})

test('deleting a default port keeps the board viewBox unchanged', async ({ page }) => {
  await page.goto('')
  const board = createBoard('standard4')
  // Every default port but the two beside the far left and right hexes: deleting
  // one of those opens a spot further out on the vertical edge, and the box grows to hold its dot.
  const ports = board.ports.map((port) => port.edgeId).filter((edgeId) => edgeId !== 'e:-2,-1;-2,0' && edgeId !== 'e:2,0;3,-1')
  expect(ports).toHaveLength(board.ports.length - 2)
  for (const edgeId of ports) {
    await seedBoard(page, board)
    await page.getByRole('button', { name: 'Edit the board' }).click()
    const svg = page.locator('.board-canvas')
    const before = await svg.getAttribute('viewBox')
    const point = await portPoint(page, board.ports.findIndex((port) => port.edgeId === edgeId))
    await clickPoint(page, point)
    await expect(svg.locator('.board-port')).toHaveCount(board.ports.length - 1)
    await expect(svg).toHaveAttribute('viewBox', before!)
  }
})
