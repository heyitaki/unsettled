import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { draftOrder, placeBuilding, placeRoad } from '../src/model/board'
import { axialToPixel, edgeEndpointVertexIds, parseVertexId, vertexAdjacentVertexIds } from '../src/model/coords'
import { newGame, type Game, type PlayerStats, type SpecialBuildRule } from '../src/model/game'
import { boardGrid } from '../src/model/layouts'
import { setActivePlayer } from '../src/model/turn'
import type { Board, EdgeId, Resource } from '../src/model/types'
import { roadSlots } from '../src/ui/placementSlots'

const NAMES = ['Red', 'Blue', 'Orange', 'White', 'Green']
const raw: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
const BASE: Board = { ...raw, mePlayerId: 'p1', players: raw.players.map((player, index) => ({ ...player, name: NAMES[index] ?? player.name })) }
// Set SPECIAL_BUILD_SHOTS to a folder to keep a screenshot of each state.
const SHOTS = process.env.SPECIAL_BUILD_SHOTS

/** A finished five-seat draft, every pick distance-legal. */
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

/** Writes `fields` over the stored game, board included, the way `seedBoard` does, and reloads. */
async function seedGame(page: Page, fields: Partial<Game>) {
  await page.goto('')
  await page.addInitScript((fields) => {
    const key = 'unsettled.workspace.v1'
    const raw = localStorage.getItem(key)
    if (raw === null) return
    const workspace = JSON.parse(raw)
    Object.assign(workspace.tabs[0].game, fields)
    delete workspace.tabs[0].activePlayerId
    localStorage.setItem(key, JSON.stringify(workspace))
  }, fields)
  await page.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** A started game on `turnSeat`'s turn, rolled 8, under `rule`. */
async function started(page: Page, rule: SpecialBuildRule, stats: Record<string, PlayerStats>, turnSeat = 0) {
  const board = drafted()
  const turn = { ...setActivePlayer(newGame(board), board.players[turnSeat].id).turn!, rolled: 8 }
  await seedGame(page, { board, stats, turn, specialBuild: rule })
  return board
}

async function clickEdge(page: Page, edge: EdgeId) {
  const centres = edgeEndpointVertexIds(edge).map((vertex) => {
    const points = parseVertexId(vertex).map((coord) => axialToPixel(coord, 58))
    return { x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }
  })
  const middle = { x: (centres[0].x + centres[1].x) / 2, y: (centres[0].y + centres[1].y) / 2 }
  const point = await page.locator('.board-canvas').evaluate((element, middle) => {
    const screen = new DOMPoint(middle.x, middle.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  }, middle)
  await page.mouse.click(point.x, point.y)
}

const step = (page: Page) => page.locator('.move-step').filter({ hasText: 'Special build' })
const chips = (page: Page) => step(page).getByRole('group', { name: 'Special builder' }).getByRole('button')

for (const arm of [{ name: 'desktop', viewport: { width: 1440, height: 1000 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  test.describe(arm.name, () => {
    test.use({ viewport: arm.viewport })
    const shot = async (page: Page, name: string, scroll?: ReturnType<Page['locator']>) => {
      if (!SHOTS) return
      await scroll?.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/${arm.name}-${name}.png` })
    }

    test('a five player import asks the special build rule, off by default', async ({ page }) => {
      const read = { roster: true, order: true, picks: true, hands: [], unorderedPicks: [], points: {}, knights: [] }
      await seedGame(page, { board: drafted(), stats: {}, pendingImport: read })
      const question = page.getByRole('group', { name: 'Special build', exact: true })
      await expect(question.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
      await shot(page, '1-setup-off', question)
      await question.getByRole('button', { name: 'On' }).click()
      await question.getByRole('button', { name: 'Across' }).click()
      await question.getByRole('button', { name: 'Over 7 cards' }).click()
      await expect(question).toContainText('three seats back')
      await shot(page, '2-setup-on', question)
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(question).toHaveCount(0)
    })

    test('every turn offers each other player who can afford something, with their own best moves', async ({ page }) => {
      const board = await started(page, { timing: 'everyTurn', who: 'always' }, {
        p1: hand({ wood: 1, brick: 1 }), p2: hand({ wood: 2, brick: 2 }), p3: hand({ sheep: 1, wheat: 1, ore: 1 }),
        p4: hand({ ore: 1 }), p5: hand({ wheat: 2, ore: 3 }),
      })
      await expect(chips(page)).toHaveText(['Blue', 'Orange', 'Green'])
      await shot(page, '3-every-turn', step(page))

      await chips(page).filter({ hasText: 'Blue' }).click()
      const advice = page.locator('.moves-panel')
      await expect(advice.getByRole('heading', { name: 'Best moves for Blue' })).toBeVisible()
      await expect(advice).toContainText('Special build: Blue may only build or buy a dev card.')
      const rows = advice.locator('.analysis-row-select')
      await expect(rows.first()).toBeVisible()
      await expect(rows.filter({ hasText: /Offer|Trade/ })).toHaveCount(0)
      await shot(page, '4-recommendations', advice)
      await shot(page, '5-blue-tray', step(page))

      // The board offers Blue's road spots, not Red's.
      await step(page).getByRole('button', { name: /Road/ }).click()
      // The pick scrolls the board into view first on a phone.
      await expect(page.locator('.board-canvas')).toBeInViewport({ ratio: 0.9 })
      await clickEdge(page, roadSlots(board, 'p2')[0])
      await expect(step(page).locator('.move-log li > span:nth-child(2)')).toHaveText(['Blue built a road'])
      await expect(page.locator('.move-step').filter({ hasText: 'Actions' }).locator('.move-log li')).toHaveCount(0)

      // A rival's dev card records at once, the type unknown.
      await chips(page).filter({ hasText: 'Orange' }).click()
      await step(page).getByRole('button', { name: /Dev card/ }).click()
      await expect(step(page).locator('.move-log li > span:nth-child(2)')).toHaveText(['Blue built a road', 'Orange bought a dev card'])
      // Orange spent everything, so the chip goes.
      await expect(chips(page)).toHaveText(['Blue', 'Green'])
      await shot(page, '6-dev-card-logged', step(page))

      await page.getByRole('button', { name: 'End turn', exact: true }).click()
      await page.locator('.history-toggle').first().click()
      await page.locator('.history-select[data-turn="1"]').click()
      const history = page.locator('.history-panel')
      await expect(history).toContainText('Special build')
      await expect(history).toContainText('Orange bought a dev card')
      await shot(page, '7-history', history)
    })

    test('across offers only the player three seats back', async ({ page }) => {
      const everyone = hand({ wood: 1, brick: 1 })
      await started(page, { timing: 'across', who: 'always' }, { p1: everyone, p2: everyone, p3: everyone, p4: everyone, p5: everyone }, 3)
      await expect(page.getByRole('heading', { name: "Record White's turn" })).toBeVisible()
      await expect(chips(page)).toHaveText(['You'])
      await expect(step(page)).toContainText('before Green rolls')
      await shot(page, '8-across', step(page))
    })

    test('over seven cards hides everyone holding seven or fewer', async ({ page }) => {
      await started(page, { timing: 'everyTurn', who: 'overSeven' }, {
        p1: hand({ wood: 1 }), p2: hand({ wood: 4, brick: 4 }), p3: hand({ wood: 1, brick: 1, sheep: 1, wheat: 1 }),
        p4: hand({ ore: 7 }), p5: hand({ wheat: 2, ore: 3 }),
      })
      await expect(chips(page)).toHaveText(['Blue'])
      await shot(page, '9-over-seven', step(page))
    })

    test('my special build dev card asks which card I drew', async ({ page }) => {
      await started(page, { timing: 'everyTurn', who: 'always' }, {
        p1: hand({ sheep: 1, wheat: 1, ore: 1 }), p2: hand({}), p3: hand({}), p4: hand({}), p5: hand({}),
      }, 4)
      await chips(page).filter({ hasText: 'You' }).click()
      await step(page).getByRole('button', { name: /Dev card/ }).click()
      await expect(step(page)).toContainText('Which card did you draw?')
      await shot(page, '10-my-dev-card', step(page))
      await step(page).getByRole('button', { name: 'Knight' }).click()
      await expect(step(page).locator('.move-log li > span:nth-child(2)')).toHaveText(['Red bought a dev card'])
      await expect(chips(page)).toHaveCount(0)
    })
  })
}
