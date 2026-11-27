// MOCK (special build phase): screenshots for the proposal, not a regression test.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { draftOrder, placeBuilding, placeRoad } from '../src/model/board'
import { axialToPixel, edgeEndpointVertexIds, parseVertexId, vertexAdjacentVertexIds } from '../src/model/coords'
import { newGame, type PlayerStats } from '../src/model/game'
import { boardGrid } from '../src/model/layouts'
import { setActivePlayer } from '../src/model/turn'
import type { Board, EdgeId, Resource } from '../src/model/types'
import { roadSlots } from '../src/ui/placementSlots'
import { seedBoard } from './seed'

const SHOTS = '/private/tmp/claude-501/-Users-aki-code-workspaces-unsettled-batfish/beb320e1-3d8d-4507-951f-c4a8bd310619/scratchpad/shots'
const NAMES = ['Red', 'Blue', 'Orange', 'White', 'Green']
const raw: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
const BASE: Board = { ...raw, mePlayerId: 'p1', players: raw.players.map((player, index) => ({ ...player, name: NAMES[index] ?? player.name })) }

function drafted(): Board {
  const grid = boardGrid(BASE.layout)
  const taken = new Set<string>()
  const spots = grid.vertexIds.filter((vertexId) => {
    if (taken.has(vertexId) || vertexAdjacentVertexIds(vertexId).some((adjacent) => taken.has(adjacent))) return false
    taken.add(vertexId)
    return true
  })
  let board = BASE
  draftOrder(board).forEach((playerId, index) => {
    board = placeBuilding(board, spots[index * 2], playerId, 'settlement')
    const edge = grid.edgeIds.find((edgeId) => edgeEndpointVertexIds(edgeId).includes(spots[index * 2]) && !board.roads.some((road) => road.edgeId === edgeId))!
    board = placeRoad(board, edge, playerId)
  })
  return board
}

const hand = (cards: Partial<Record<Resource, number>>): PlayerStats => ({
  hand: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0, ...cards },
  handUnknown: 0, devCards: 0, knights: 0, vpCards: 0,
})

async function clickEdge(page: Page, edge: EdgeId) {
  const centres = edgeEndpointVertexIds(edge).map((vertex) => {
    const points = parseVertexId(vertex).map((coord) => axialToPixel(coord, 58))
    return { x: points.reduce((s, p) => s + p.x, 0) / 3, y: points.reduce((s, p) => s + p.y, 0) / 3 }
  })
  const mid = { x: (centres[0].x + centres[1].x) / 2, y: (centres[0].y + centres[1].y) / 2 }
  const point = await page.locator('.board-canvas').evaluate((element, mid) => {
    const p = new DOMPoint(mid.x, mid.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
    return { x: p.x, y: p.y }
  }, mid)
  await page.mouse.click(point.x, point.y)
}

for (const arm of [{ name: 'desktop', viewport: { width: 1440, height: 1000 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  test(`special build mock ${arm.name}`, async ({ page }) => {
    await page.setViewportSize(arm.viewport)
    const board = drafted()
    const stats = {
      p1: hand({ wood: 1, sheep: 2, ore: 1 }), p2: hand({ wood: 2, brick: 2 }), p3: hand({ wood: 1, brick: 1, sheep: 1, wheat: 1 }),
      p4: hand({ ore: 1 }), p5: hand({ wheat: 2, ore: 3 }),
    }
    await page.goto('')
    const turn = { ...setActivePlayer(newGame(board), 'p1').turn!, rolled: 8, log: ['Traded 1 brick to Blue for 1 sheep'] }
    await seedBoard(page, board, stats, turn)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const step = page.locator('.move-step').filter({ hasText: 'Special build' })
    await expect(step).toBeVisible()
    await step.scrollIntoViewIfNeeded()
    const shot = (name: string) => page.screenshot({ path: `${SHOTS}/${arm.name}-${name}.png` })
    await shot('1-step')
    await step.getByRole('button', { name: 'Blue' }).click()
    await shot('2-blue-tray')
    await step.getByRole('button', { name: /Road/ }).click()
    await shot('3-blue-road-pick')
    await clickEdge(page, roadSlots(board, 'p2')[0])
    await expect(step.locator('.move-log li')).toHaveCount(1)
    await step.getByRole('button', { name: 'Green' }).click()
    await step.getByRole('button', { name: /City/ }).click()
    await shot('4-green-city-pick')
    const city = board.buildings.find((b) => b.playerId === 'p5')!.vertexId
    const corner = parseVertexId(city).map((coord) => axialToPixel(coord, 58))
    const point = await page.locator('.board-canvas').evaluate((element, c) => {
      const p = new DOMPoint(c.x, c.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
      return { x: p.x, y: p.y }
    }, { x: corner.reduce((s, p) => s + p.x, 0) / 3, y: corner.reduce((s, p) => s + p.y, 0) / 3 })
    await page.mouse.click(point.x, point.y)
    await expect(step.locator('.move-log li')).toHaveCount(2)
    await step.scrollIntoViewIfNeeded()
    await shot('5-logged')
    await page.getByRole('button', { name: 'End turn', exact: true }).click()
    await page.locator('.history-toggle').first().click()
    await page.locator('.history-select[data-turn="1"]').click()
    await shot('6-history')
    await page.locator('.history-select[data-turn="2"]').click()
    await shot('7-history-collapsed')
  })
}
