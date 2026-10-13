import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds, vertexIncidentEdgeIds } from '../../model/coords'
import type { Board, EdgeId, VertexId } from '../../model/types'
import { contestRivals, expansionSpots, rowContest } from '../contest'
import { blockedVertices, vertexAdjacency } from '../legality'

const adjacency = vertexAdjacency('standard4')
const near = (vertexId: VertexId) => adjacency.get(vertexId)!
const edge = (a: VertexId, b: VertexId): EdgeId =>
  vertexIncidentEdgeIds(a).find((edgeId) => edgeEndpointVertexIds(edgeId).includes(b))!

function roster(): Board {
  const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' })
  return addPlayer(board, { id: 'c', name: 'White', color: '#ffffff' })
}
const ME = roster().players[0].id
const P = [...adjacency.keys()].find((vertexId) => near(vertexId).length === 3
  && near(vertexId).every((n) => near(n).length === 3 && near(n).every((s) => near(s).length === 3
    && near(s).every((t) => near(t).length === 3))))!
const N = near(P)[0]
const ROAD = edge(P, N)
const [S1, S2] = near(N).filter((vertexId) => vertexId !== P)
const [T1, T2] = near(S1).filter((vertexId) => vertexId !== N)
const U1 = near(T1).find((vertexId) => vertexId !== S1)!
const U2 = near(T2).find((vertexId) => vertexId !== S1 && vertexId !== U1 && !near(U1).includes(vertexId))!
const V = near(S2).find((vertexId) => vertexId !== N)!
const W = near(V).find((vertexId) => vertexId !== S2)!
const row = { firstPick: P, firstRoad: ROAD }
const settle = (board: Board, playerId: string, vertexId: VertexId, toward: VertexId) =>
  placeRoad(placeBuilding(board, vertexId, playerId, 'settlement'), edge(vertexId, toward), playerId)

describe('contest fixture', () => {
  it('has distinct corners for the pick, spots and rival road ends', () => {
    const named = [P, N, S1, S2, T1, T2, U1, U2, V, W]
    expect(named.every((vertexId) => vertexId !== undefined)).toBe(true)
    expect(new Set(named).size).toBe(named.length)
  })
})

describe('expansionSpots', () => {
  it('lists legal corners one road past the far end in edge order', () => {
    expect(expansionSpots(roster(), ME, P, ROAD)).toEqual(
      [S1, S2].sort((a, b) => edge(N, a) < edge(N, b) ? -1 : 1))
  })

  it('has no spots without a road or when the road does not leave the pick', () => {
    expect(expansionSpots(roster(), ME, P, null)).toEqual([])
    expect(expansionSpots(roster(), ME, P, edge(S1, T1))).toEqual([])
  })

  it('rejects a rival road from the pick and accepts the viewed seat road', () => {
    expect(expansionSpots(placeRoad(roster(), ROAD, 'b'), ME, P, ROAD)).toEqual([])
    expect(expansionSpots(placeRoad(roster(), ROAD, ME), ME, P, ROAD)).toHaveLength(2)
  })

  it('drops a spot behind a rival edge and keeps one behind the viewed seat edge', () => {
    expect(expansionSpots(placeRoad(roster(), edge(N, S1), 'b'), ME, P, ROAD)).toEqual([S2])
    expect(expansionSpots(placeRoad(roster(), edge(N, S1), ME), ME, P, ROAD)).toContain(S1)
  })

  it('drops a spot with a building on it or beside it', () => {
    expect(expansionSpots(placeBuilding(roster(), S1, 'b', 'settlement'), ME, P, ROAD)).toEqual([S2])
    expect(expansionSpots(placeBuilding(roster(), T1, 'b', 'settlement'), ME, P, ROAD)).toEqual([S2])
  })

  it('has no spots when the far end carries a building', () => {
    expect(expansionSpots(placeBuilding(roster(), N, 'b', 'settlement'), ME, P, ROAD)).toEqual([])
  })
})

describe('contestRivals and rowContest', () => {
  it('finds a rival road end next to the spot', () => {
    const board = settle(roster(), 'b', U1, T1)
    expect(blockedVertices('standard4', [U1]).has(S1)).toBe(false)
    expect(contestRivals(board, ME, S1)).toEqual(['b'])
    expect(rowContest(board, ME, row).contested).toEqual([{ vertexId: S1, playerId: 'b' }])
  })

  it('finds a rival road end on the spot itself', () => {
    const board = placeRoad(settle(roster(), 'b', U1, T1), edge(T1, S1), 'b')
    expect(contestRivals(board, ME, S1)).toEqual(['b'])
    expect(contestRivals(settle(roster(), 'b', T1, S1), ME, S1)).toEqual(['b'])
  })

  it('finds no road end on a built corner', () => {
    const board = placeBuilding(settle(roster(), 'b', U1, T1), T1, 'c', 'settlement')
    expect(contestRivals(board, ME, S1)).toEqual([])
    expect(rowContest(board, ME, row).spots).toEqual([S2])
  })

  it('stops a rival behind a third seat edge and counts that third seat', () => {
    const board = placeRoad(settle(roster(), 'b', U1, T1), edge(T1, S1), 'c')
    expect(contestRivals(board, ME, S1)).toEqual(['c'])
  })

  it('stops a rival behind the viewed seat edge', () => {
    const board = placeRoad(settle(roster(), 'b', U1, T1), edge(T1, S1), ME)
    expect(contestRivals(board, ME, S1)).toEqual([])
  })

  it('never counts the viewed seat', () => {
    expect(contestRivals(settle(roster(), ME, U1, T1), ME, S1)).toEqual([])
    expect(contestRivals(placeRoad(roster(), edge(S1, T1), ME), ME, S1)).toEqual([])
  })

  it('lists two rivals on one spot in roster order', () => {
    const board = settle(settle(roster(), 'c', U1, T1), 'b', U2, T2)
    expect(rowContest(board, ME, row).contested).toEqual([
      { vertexId: S1, playerId: 'b' },
      { vertexId: S1, playerId: 'c' },
    ])
  })

  it('lists one rival on both spots in spot order', () => {
    const board = settle(settle(roster(), 'b', U1, T1), 'b', W, V)
    const spots = [S1, S2].sort((a, b) => edge(N, a) < edge(N, b) ? -1 : 1)
    expect(rowContest(board, ME, row)).toEqual({
      spots, contested: spots.map((vertexId) => ({ vertexId, playerId: 'b' })),
    })
  })

  it('counts a rival road ending on the far end of the row road', () => {
    const board = settle(roster(), 'b', S2, N)
    expect(rowContest(board, ME, row)).toEqual({ spots: [S1], contested: [{ vertexId: S1, playerId: 'b' }] })
  })
})
