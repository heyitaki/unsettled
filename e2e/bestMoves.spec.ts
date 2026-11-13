import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { draftOrder, placeBuilding, placeRoad } from '../src/model/board'
import { edgeEndpointVertexIds, vertexAdjacentVertexIds } from '../src/model/coords'
import { newGame, type PlayerStats } from '../src/model/game'
import { boardGrid } from '../src/model/layouts'
import { awaitingFirstTurn, setActivePlayer } from '../src/model/turn'
import type { Board, Resource } from '../src/model/types'
import { seedBoard } from './seed'

const RED = '#c23f38'
const BASE: Board = {
  ...JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8')),
  mePlayerId: 'p1',
}

/** A five-seat `extension6` draft with its first `picks` settlements and roads placed, spread so every pick is distance-legal. */
function drafted(picks: number): Board {
  const grid = boardGrid(BASE.layout)
  const taken = new Set<string>()
  const spots = grid.vertexIds.filter((vertexId) => {
    if (taken.has(vertexId) || vertexAdjacentVertexIds(vertexId).some((adjacent) => taken.has(adjacent))) return false
    taken.add(vertexId)
    return true
  })
  let board = BASE
  draftOrder(board).slice(0, picks).forEach((playerId, index) => {
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

async function open(page: Page, board: Board, stats: Record<string, PlayerStats> = {}) {
  await page.goto('')
  // A finished draft opens on the recap; these tests start past it, on the first player's turn.
  const game = newGame(board)
  await seedBoard(page, board, stats, awaitingFirstTurn(game) ? setActivePlayer(game, board.players[0].id).turn : undefined)
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

const panel = (page: Page) => page.locator('.best-moves-panel')
const redRow = (page: Page) => panel(page).locator('.ledger-row').first().locator('.ledger-hand, .ledger-cards')

function suite() {
  test('Best moves follows the recap after the last draft pick is placed', async ({ page }) => {
    const board = drafted(9)
    await open(page, board)
    await expect(page.getByRole('heading', { name: 'Best picks' })).toBeVisible()
    await page.locator('.analysis-row-select').first().click()
    await page.getByRole('button', { name: 'Place settlement' }).click()
    await page.getByRole('button', { name: 'Start game' }).click()
    await expect(panel(page).getByRole('heading', { name: 'Best moves' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^View .+'s best moves$/ })).toHaveCount(board.players.length)
    await expect(page.getByRole('button', { name: "View P1's best moves" })).toHaveAttribute('aria-pressed', 'true')
  })


  test('views another hand without moving the recording turn and resets the view on End turn', async ({ page }) => {
    await open(page, drafted(10), { p1: hand({ wood: 1, brick: 1 }), p2: hand({ wood: 1, brick: 1 }) })
    await page.getByRole('button', { name: "View P2's best moves" }).click()
    await expect(page.getByRole('button', { name: "View P2's best moves" }).locator('.head-dot-chip')).toHaveText('P2')
    await expect(page.getByRole('heading', { name: 'Record your turn', exact: true })).toBeVisible()
    const advice = panel(page).filter({ has: page.getByRole('heading', { name: 'Best moves for P2', exact: true }) })
    await expect(advice).toContainText("Not P2's turn.")
    await advice.locator('.analysis-row-select').first().click()
    await expect(advice.locator('.analysis-row.current')).toHaveCount(1)
    await expect(advice.getByRole('button', { name: /^(Apply|End turn)/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: "View P1's best moves" }).locator('.head-dot.me')).toHaveCount(1)
    await page.getByRole('button', { name: "View P3's best moves" }).click()
    await panel(page).getByRole('button', { name: 'End turn', exact: true }).click()
    await expect(page.getByRole('heading', { name: "Record P2's turn", exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: "View P2's best moves" })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: "View P2's best moves" }).locator('.head-dot.me.head-dot-chip')).toHaveCount(1)
  })

  test('a selected move pins its mark, Apply builds and pays, and one undo restores both', async ({ page }) => {
    await open(page, drafted(10), { p1: hand({ wood: 1, brick: 1 }) })
    // No token on this board carries a 2 next to a red settlement, so the hand stays at one road's worth.
    await panel(page).getByRole('group', { name: 'Dice total' }).getByRole('button', { name: '2', exact: true }).click()
    const before = await redRow(page).allInnerTexts()
    // A road is a rotated group holding a casing and a core in the owner's colour.
    const pieces = page.locator(`.board-canvas g[transform*="rotate"] > rect[fill="${RED}"]`)
    const placed = await pieces.count()

    const road = panel(page).locator('.analysis-row', { hasText: 'Build road' }).first()
    await expect(road.locator('.move-reason')).not.toBeEmpty()
    await road.locator('.analysis-row-select').click()
    await expect(road).toHaveClass(/current/)
    await page.mouse.move(0, 0)
    await expect(page.locator('.board-canvas [class*="highlight"]')).not.toHaveCount(0)

    await road.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(pieces).toHaveCount(placed + 1)
    await expect.poll(() => redRow(page).allInnerTexts()).not.toEqual(before)

    await panel(page).locator('.panel-heading').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(pieces).toHaveCount(placed)
    await expect.poll(() => redRow(page).allInnerTexts()).toEqual(before)
  })

  test('a seven shows what to discard and where to move the robber', async ({ page }) => {
    await open(page, drafted(10), { p1: hand({ wood: 4, brick: 4 }) })
    await panel(page).getByRole('group', { name: 'Dice total' }).getByRole('button', { name: '7', exact: true }).click()
    const discard = panel(page).getByRole('group', { name: "P1's discard" })
    await expect(discard).toContainText(/Keeps|toward/)
    // Discards come first: the robber prompt waits for them.
    await expect(panel(page).locator('.move-robber')).toHaveCount(0)
    await discard.getByRole('button', { name: 'Record', exact: true }).click()
    await expect(redRow(page).last()).toHaveText('4')
    await expect(panel(page).locator('.move-robber')).toContainText(/Suggested: .+, (rob nobody|steal from P\d)/)
    await expect(page.locator('.board-canvas .hex-highlight')).toHaveCount(1)
  })

  test('an offer entered on a rival turn is answered with accept or decline', async ({ page }) => {
    await open(page, drafted(10), { p1: hand({ wood: 2, sheep: 1 }), p2: hand({ brick: 2 }) })
    await panel(page).getByRole('button', { name: 'End turn', exact: true }).click()
    await panel(page).getByRole('button', { name: 'Trade', exact: true }).click()
    await panel(page).getByRole('button', { name: 'Gives brick', exact: true }).click()
    await panel(page).getByRole('button', { name: 'Gets wood', exact: true }).click()
    await expect(panel(page).locator('.move-verdict')).toContainText(/Advice for you: (Accept|Decline) \(/)
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1100 } })
  suite()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  suite()
})
