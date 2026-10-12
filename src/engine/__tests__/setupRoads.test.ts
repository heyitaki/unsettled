import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setMe } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { boardGrid } from '../../model/layouts'
import { RESOURCES } from '../../model/types'
import { analyzeBoard, simulateWindowDetailed } from '../analyze'
import { expansionTerm } from '../expansion'
import { blockedVertices, legalSettlementVertices } from '../legality'
import { addToHoldings, computeBoardContext, emptyHoldings, occupancyFromBoard } from '../valuation'
import { DEFAULT_WEIGHTS } from '../weights'

function opening() {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' })
  for (const [index, hex] of board.hexes.entries()) board = setTile(board, hex.coord, RESOURCES[index % RESOURCES.length], 6)
  return board
}

describe('setup road occupancy', () => {
  it('chooses forced roads before each settlement lands, using the picker holdings and earlier roads', () => {
    const board = opening()
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const occupied = new Set(occupancyFromBoard(board).blocked)
    const edgeOwner = new Map(occupancyFromBoard(board).edgeOwner)
    const initial = emptyHoldings()
    let replay = board
    let held = initial
    const picks = [legalSettlementVertices(replay)[15]]
    replay = placeBuilding(replay, picks[0], 'b', 'settlement')
    picks.push(legalSettlementVertices(replay)[20])
    replay = board
    const expected = picks.map((vertexId) => {
      const road = expansionTerm(ctx, held, occupancyFromBoard(replay, 'b'), vertexId).road
      replay = placeBuilding(replay, vertexId, 'b', 'settlement')
      if (road !== null) replay = placeRoad(replay, road, 'b')
      held = addToHoldings(ctx, held, vertexId)
      return road
    })
    expect(expected.every((road) => road !== null)).toBe(true)
    const result = simulateWindowDetailed(
      ctx, board,
      [false, true].map((receivesGrant) => ({ playerId: 'b', receivesGrant, hasLaterPick: !receivesGrant })),
      new Map([['b', initial]]), blockedVertices(board.layout, []), occupied, edgeOwner, () => 0,
      (taken) => picks[taken.length],
    )
    expect(result.taken).toEqual(picks)
    expect(result.roads).toEqual(expected)
    expect(result.holdings.get('b')).toEqual(held)
    expect(occupied).toEqual(new Set(picks))
    expect(edgeOwner).toEqual(occupancyFromBoard(replay).edgeOwner)
    expect(occupancyFromBoard(board).edgeOwner.size).toBe(0)
    expect(initial.vertices).toEqual([])
  })

  it('lays no fallback road when the walk is disabled or a pick opens nothing', () => {
    const board = opening()
    const vertexId = legalSettlementVertices(board)[15]
    for (const disabled of [false, true]) {
      const ctx = computeBoardContext(board, { ...DEFAULT_WEIGHTS, expansionWeight: disabled ? 0 : 0.1 })
      const occupied = disabled ? new Set<typeof vertexId>() : new Set(boardGrid(board.layout).vertexIds)
      occupied.delete(vertexId)
      const edges = new Map(occupancyFromBoard(board).edgeOwner)
      const result = simulateWindowDetailed(
        ctx, board, [{ playerId: 'b', receivesGrant: false, hasLaterPick: true }],
        new Map(), new Set(), occupied, edges, () => 0, () => vertexId,
      )
      expect(result.taken).toEqual([vertexId])
      expect(result.roads).toEqual([null])
      expect(edges.size).toBe(0)
    }
    const analysis = analyzeBoard(setMe(board, 'b'), { rollouts: 1, weights: { ...DEFAULT_WEIGHTS, expansionWeight: 0 } })
    expect(analysis.takenBeforeFirstPick.map(({ road }) => road)).toEqual([null])
    expect(analysis.recommendations.length).toBeGreaterThan(0)
    expect(analysis.recommendations.every(({ firstRoad, secondRoad }) => firstRoad === null && secondRoad === null)).toBe(true)
  })

  it('keeps the board and its cached occupancy unchanged across analyses', () => {
    const board = placeRoad(opening(), boardGrid('standard4').edgeIds[0], 'b')
    const original = structuredClone(board)
    const owners = new Map(occupancyFromBoard(board).edgeOwner)
    const options = { rollouts: 2 }
    const first = analyzeBoard(board, options)
    expect(first.recommendations.length).toBeGreaterThan(0)
    expect(analyzeBoard(board, options)).toEqual(first)
    expect(board).toEqual(original)
    expect(occupancyFromBoard(board).edgeOwner).toEqual(owners)
  })
})
