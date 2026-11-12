import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { emptyStats, newGame, type Game } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { adjustDevHand, CARD_COSTS, endTurn, recordBuyDev, recordPlayDev, recordRobber, recordRoll, setActivePlayer } from '../../model/turn'
import { availableActions, buildablePieces, couldAfford, robberPending } from '../bestMoves'
import { buildingSlots, roadSlots } from '../placementSlots'

function funded(): Game {
  const board = placeBuilding(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }),
    boardGrid('standard4').vertexIds[0], 'aki', 'settlement')
  const game = newGame(board)
  return { ...game, stats: { ...game.stats, aki: { ...emptyStats(), hand: { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 } } } }
}

describe('move availability', () => {
  it('covers the total resource shortfall with unknown cards, without using surplus known cards', () => {
    const stats = { ...emptyStats(), hand: { ...emptyStats().hand, wood: 10, wheat: 1 } }
    expect(couldAfford(stats, CARD_COSTS.devCard)).toBe(false)
    expect(couldAfford({ ...stats, handUnknown: 1 }, CARD_COSTS.devCard)).toBe(false)
    expect(couldAfford({ ...stats, handUnknown: 2 }, CARD_COSTS.devCard)).toBe(true)
    expect(couldAfford({ ...stats, hand: { ...stats.hand, sheep: 1, ore: 1 } }, CARD_COSTS.devCard)).toBe(true)
  })

  it('hides all actions for an empty hand without dev cards', () => {
    expect(availableActions(newGame(funded().board), 'aki')).toEqual({ trade: false, buy: false, play: false, build: false })
  })

  it('allows trades with unseen cards and buys only when affordable and the deck is not known empty', () => {
    const game = funded()
    game.stats.aki = { ...emptyStats(), handUnknown: 1 }
    expect(availableActions(game, 'aki')).toMatchObject({ trade: true, buy: false })
    game.stats.aki.handUnknown = 3
    expect(availableActions(game, 'aki')).toMatchObject({ buy: true })
    expect(availableActions(game, 'aki', 1)).toMatchObject({ buy: true })
    expect(availableActions(game, 'aki', 0)).toMatchObject({ buy: false })
  })

  it('uses typed playable dev cards for the claimed player and public counts for rivals', () => {
    let game = adjustDevHand(funded(), 'bought', 'knight', 1)
    game.stats.b.devCards = 1
    expect(availableActions(game, 'aki').play).toBe(false)
    expect(availableActions(game, 'b').play).toBe(true)
    game = adjustDevHand(game, 'playable', 'knight', 1)
    expect(availableActions(game, 'aki').play).toBe(true)
    game = recordPlayDev(game, { kind: 'roadBuilding', edges: [] })
    expect(availableActions(game, 'aki').play).toBe(false)
  })

  it('requires both an affordable piece and a legal slot for that player', () => {
    const game = funded()
    expect(buildablePieces(game, 'aki')).toEqual(['road', 'city'])
    expect(buildablePieces(game, 'b')).toEqual([])
    expect(buildablePieces({ ...game, board: { ...game.board, buildings: [] } }, 'aki')).toEqual([])
    game.stats.aki.hand = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 }
    expect(buildablePieces(game, 'aki')).toEqual(['road'])
    game.stats.aki.hand = { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 3 }
    expect(buildablePieces(game, 'aki')).toEqual(['city'])
  })

  it('finds connected settlement slots through the same rules as the board pick', () => {
    const game = funded()
    const edges = boardGrid(game.board.layout).edgeIds
    const edge = edges.find((id) => edgeEndpointVertexIds(id).every((vertex) => !game.board.buildings.some((building) => building.vertexId === vertex)))!
    game.board = placeRoad(game.board, edge, 'aki')
    expect(buildingSlots(game.board, 'aki', 'settlement', 'build').length).toBeGreaterThan(0)
    expect(buildablePieces(game, 'aki')).toContain('settlement')
  })

  it('does not offer exhausted road, settlement or city supplies', () => {
    const grid = boardGrid('standard4')
    const roads = funded()
    for (let count = 0; count < 15; count += 1) roads.board = placeRoad(roads.board, roadSlots(roads.board, 'aki')[0], 'aki')
    expect(roadSlots(roads.board, 'aki').length).toBeGreaterThan(0)
    expect(buildablePieces(roads, 'aki')).not.toContain('road')

    const settlements = funded()
    for (const vertex of grid.vertexIds) {
      if (settlements.board.buildings.length === 5) break
      if (buildingSlots(settlements.board, 'aki', 'settlement', 'edit').includes(vertex)) settlements.board = placeBuilding(settlements.board, vertex, 'aki', 'settlement')
    }
    const open = buildingSlots(settlements.board, 'aki', 'settlement', 'edit')[0]
    settlements.board = placeRoad(settlements.board, grid.edgeIds.find((edge) => edgeEndpointVertexIds(edge).includes(open))!, 'aki')
    expect(buildingSlots(settlements.board, 'aki', 'settlement', 'build').length).toBeGreaterThan(0)
    expect(buildablePieces(settlements, 'aki')).not.toContain('settlement')

    const cities = funded()
    for (const vertex of grid.vertexIds.slice(10, 14)) cities.board = placeBuilding(cities.board, vertex, 'aki', 'city')
    expect(buildingSlots(cities.board, 'aki', 'city', 'build')).not.toHaveLength(0)
    expect(buildablePieces(cities, 'aki')).not.toContain('city')
  })
})

describe('robberPending', () => {
  const initial = funded()
  initial.board = { ...initial.board, robber: { q: 0, r: 0 } }
  const rolled = recordRoll(initial, 7, {})
  const moved = recordRobber(rolled, { q: 0, r: 1 }, null, null)

  it('follows the roll boundary through undo and redo, including deserialized snapshots', () => {
    expect(robberPending(rolled)).toBe(true)
    expect(robberPending(moved)).toBe(false)
    const knight = recordPlayDev(moved, { kind: 'knight', hex: initial.board.robber!, victimId: null, stolen: null })
    expect(robberPending(knight)).toBe(false)
    expect(robberPending(JSON.parse(JSON.stringify(moved)))).toBe(false)
  })

  it('keeps pending sevens after reload and leaves legacy turns and fresh turns done', () => {
    expect(robberPending(JSON.parse(JSON.stringify(rolled)))).toBe(true)
    const legacy = { ...rolled, turn: { ...rolled.turn! } }
    delete legacy.turn.robberMoved
    expect(robberPending(legacy)).toBe(false)
    const next = endTurn(moved)
    expect(robberPending(next)).toBe(false)
    const seven = recordRoll(next, 7, {})
    expect(robberPending(seven)).toBe(true)
    expect(robberPending(setActivePlayer(seven, 'aki'))).toBe(false)
  })
})

it('excludes purchases this turn from untyped playable dev cards', () => {
  const rival = setActivePlayer(funded(), 'b')
  const bought = recordBuyDev(rival, null)
  expect(availableActions(bought, 'b').play).toBe(false)
  expect(availableActions({ ...bought, stats: { ...bought.stats, b: { ...bought.stats.b, devCards: 2 } } }, 'b').play).toBe(true)
  expect(availableActions(setActivePlayer(endTurn(bought), 'b'), 'b').play).toBe(true)
  const own = recordBuyDev(funded(), null)
  expect(availableActions(own, 'aki').play).toBe(false)
})
