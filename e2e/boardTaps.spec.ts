import { expect, test, type Page } from '@playwright/test'
import { createBoard, setHexTile, setRobber } from '../src/model/board'
import { axialToPixel } from '../src/model/coords'
import { BLANK_TILE_COLOR } from '../src/ui/colors'
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

test('deleting a port and tapping its empty spot opens Edit port again', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: 'Edit the board' }).click()
  const badges = page.locator('.board-canvas .port-text')
  const count = await badges.count()
  const point = await badges.first().evaluate((badge) => ({
    x: Number(badge.getAttribute('x')),
    y: Number(badge.getAttribute('y')) - 4,
  }))
  await clickPoint(page, point)
  const editor = page.locator('.port-popover')
  await expect(editor.getByRole('heading', { name: 'Edit port' })).toBeVisible()
  const edge = await editor.locator('code').textContent()
  await editor.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(badges).toHaveCount(count - 1)
  await clickPoint(page, point)
  await expect(editor.getByRole('heading', { name: 'Edit port' })).toBeVisible()
  await expect(editor.locator('code')).toHaveText(edge!)
  await expect(editor.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Save port', exact: true }).click()
  await expect(badges).toHaveCount(count)
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
    const point = await svg.locator('.port-text').nth(board.ports.findIndex((port) => port.edgeId === edgeId)).evaluate((badge) => ({
      x: Number(badge.getAttribute('x')),
      y: Number(badge.getAttribute('y')) - 4,
    }))
    await clickPoint(page, point)
    const editor = page.locator('.port-popover')
    await expect(editor.locator('code')).toHaveText(edgeId)
    await editor.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(svg.locator('.port-text')).toHaveCount(board.ports.length - 1)
    await expect(svg).toHaveAttribute('viewBox', before!)
  }
})
