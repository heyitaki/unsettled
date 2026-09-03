import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  placeBuilding,
  placeRoad,
  setHexTile,
  setNumberToken,
  setRobber,
} from '../../model/board'
import { edgeEndpointVertexIds, vertexIncidentEdgeIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { RESOURCES, type Board, type EdgeId, type VertexId } from '../../model/types'
import { expansionSites, expansionSitesByEdge, expansionTerm } from '../expansion'
import { vertexAdjacency } from '../legality'
import {
  addToHoldings,
  breakdownTotal,
  computeBoardContext,
  emptyHoldings,
  emptyOccupancy,
  marginalBreakdown,
  marginalTotal,
  marginalWithoutExpansion,
  occupancyFromBoard,
} from '../valuation'
import { DEFAULT_WEIGHTS, type EngineWeights } from '../weights'

const grid = boardGrid('standard4')
const adjacency = vertexAdjacency('standard4')
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]

/** Every hex tiled and numbered, two seats, so the only thing a case varies is the pieces. */
function completeBoard(uniform = false): Board {
  let board = createBoard('standard4')
  grid.landCoords.forEach((coord, index) => {
    board = setHexTile(board, coord, uniform ? 'wheat' : RESOURCES[index % RESOURCES.length])
    board = setNumberToken(board, coord, uniform ? 6 : TOKENS[index % TOKENS.length])
  })
  board = setRobber(board, null)
  board = addPlayer(board, { id: 'me', name: 'Me', color: '#111111' })
  return addPlayer(board, { id: 'foe', name: 'Foe', color: '#222222' })
}

const withWeights = (changes: Partial<EngineWeights>): EngineWeights => ({
  ...DEFAULT_WEIGHTS,
  ...changes,
})

const incidentEdges = (vertexId: VertexId): EdgeId[] =>
  vertexIncidentEdgeIds(vertexId).filter((edgeId) => grid.edgeIds.includes(edgeId)).sort()

// An interior vertex on three hexes, so every direction out of it is open board.
const CANDIDATE: VertexId = 'v:-1,0;-1,1;0,0'

/** The vertices two steps out, which ring the candidate without touching it. */
const secondRing = (vertexId: VertexId): VertexId[] => {
  const first = adjacency.get(vertexId) ?? []
  return [...new Set(first.flatMap((neighbour) => adjacency.get(neighbour) ?? []))]
    .filter((candidate) => candidate !== vertexId && !first.includes(candidate))
}

describe('expansion term', () => {
  const witness = withWeights({ expansionWeight: 0.3 })

  it('prices the two best sites the candidate opens', () => {
    const open = completeBoard()
    // Rivals on the whole second ring: every path out of the candidate dies on a settlement
    // before it reaches a legal site, while the candidate's own production is untouched.
    const boxed = secondRing(CANDIDATE).reduce(
      (board, vertexId) => placeBuilding(board, vertexId, 'foe', 'settlement'),
      open,
    )
    const openCtx = computeBoardContext(open, witness)
    const boxedCtx = computeBoardContext(boxed, witness)
    const openOccupancy = occupancyFromBoard(open, 'me')
    const boxedOccupancy = occupancyFromBoard(boxed, 'me')

    const sites = expansionSites('standard4', openOccupancy, new Set([CANDIDATE]), CANDIDATE)
    expect(sites.length).toBeGreaterThan(1)
    const held = addToHoldings(openCtx, emptyHoldings(), CANDIDATE)
    const discounted = sites
      .map((site) =>
        marginalWithoutExpansion(openCtx, held, site.vertexId) *
          witness.expansionDecay ** site.paidBuilds)
      .sort((left, right) => right - left)
    const expected = witness.expansionWeight * (discounted[0] + discounted[1])

    const openScore = marginalBreakdown(openCtx, emptyHoldings(), CANDIDATE, null, openOccupancy)
    const boxedScore = marginalBreakdown(boxedCtx, emptyHoldings(), CANDIDATE, null, boxedOccupancy)
    expect(openScore.expansion).toBe(expected)
    expect(expansionSites('standard4', boxedOccupancy, new Set([CANDIDATE]), CANDIDATE)).toEqual([])
    expect(boxedScore.expansion).toBe(0)
    // The two boards differ only in the rivals' pieces, so every other component is untouched and
    // the whole gap is the term.
    expect({ ...openScore, expansion: 0 }).toEqual(boxedScore)
    expect(breakdownTotal(openScore)).toBeGreaterThan(breakdownTotal(boxedScore))
  })

  it("treats a rival road as impassable and the seat's own as free", () => {
    const board = completeBoard()
    const [first, second, third] = incidentEdges(CANDIDATE)
    const ctx = computeBoardContext(board, witness)
    const openSites = expansionSites(
      'standard4',
      occupancyFromBoard(board, 'me'),
      new Set([CANDIDATE]),
      CANDIDATE,
    )

    const twoClosed = placeRoad(placeRoad(board, first, 'foe'), second, 'foe')
    const throughThird = occupancyFromBoard(twoClosed, 'me')
    const narrowed = expansionSites('standard4', throughThird, new Set([CANDIDATE]), CANDIDATE)
    expect(narrowed.length).toBeGreaterThan(0)
    expect(narrowed.length).toBeLessThan(openSites.length)
    expect(narrowed.every((site) => site.firstEdge === third)).toBe(true)
    expect(expansionTerm(ctx, emptyHoldings(), throughThird, CANDIDATE).road).toBe(third)

    const allClosed = placeRoad(twoClosed, third, 'foe')
    const closed = occupancyFromBoard(allClosed, 'me')
    expect(expansionSites('standard4', closed, new Set([CANDIDATE]), CANDIDATE)).toEqual([])
    expect(expansionTerm(computeBoardContext(allClosed, witness), emptyHoldings(), closed, CANDIDATE))
      .toEqual({ value: 0, road: null })

    // The same three roads in the seat's own name cost it nothing: they are its network, not a
    // rival's wall.
    const mine = incidentEdges(CANDIDATE).reduce(
      (next, edgeId) => placeRoad(next, edgeId, 'me'),
      board,
    )
    const ownRoads = occupancyFromBoard(mine, 'me')
    const owned = expansionSites('standard4', ownRoads, new Set([CANDIDATE]), CANDIDATE)
    // Strictly more, not merely no fewer: the free setup road is still in hand after travelling
    // an own road, so the horizon reaches one ring further than it does off the bare board. A
    // walk that spent the road on every first step would tie here, not lose.
    expect(owned.length).toBeGreaterThan(openSites.length)
    // And the sites the bare board already reached are reached for no more than they cost there.
    for (const site of openSites) {
      const same = owned.find((reached) => reached.vertexId === site.vertexId)
      expect(same?.paidBuilds).toBeLessThanOrEqual(site.paidBuilds)
    }
    // Named as somebody else, the very same roads close the candidate in.
    expect(expansionSites(
      'standard4',
      occupancyFromBoard(mine, 'foe'),
      new Set([CANDIDATE]),
      CANDIDATE,
    )).toEqual([])
  })

  it('folds a site to its cheapest first edge and lists sites in vertex order', () => {
    const board = completeBoard()
    const occupancy = occupancyFromBoard(board, 'me')
    const own = new Set([CANDIDATE])
    const byEdge = expansionSitesByEdge('standard4', occupancy, own, CANDIDATE)
    const folded = expansionSites('standard4', occupancy, own, CANDIDATE)

    expect([...folded].sort((left, right) =>
      left.vertexId < right.vertexId ? -1 : left.vertexId > right.vertexId ? 1 : 0))
      .toEqual(folded)
    expect(new Set(folded.map((site) => site.vertexId)).size).toBe(folded.length)

    // Every kept site is the cheapest reading of that vertex anywhere in the walk, and among the
    // cheapest readings it is the one through the lower edge id.
    const reached = new Map<VertexId, { paidBuilds: number; firstEdge: EdgeId }[]>()
    for (const sites of byEdge.values()) {
      for (const site of sites) {
        reached.set(site.vertexId, [...(reached.get(site.vertexId) ?? []), site])
      }
    }
    expect(folded.length).toBe(reached.size)
    for (const site of folded) {
      const all = reached.get(site.vertexId) ?? []
      const cheapest = Math.min(...all.map((one) => one.paidBuilds))
      expect(site.paidBuilds).toBe(cheapest)
      expect(site.firstEdge).toBe(
        all.filter((one) => one.paidBuilds === cheapest)
          .map((one) => one.firstEdge)
          .sort()[0],
      )
    }
    // A vertex reachable through more than one direction is what makes the rule bite.
    expect([...reached.values()].some((all) => new Set(all.map((one) => one.firstEdge)).size > 1))
      .toBe(true)
  })

  it('records a site once per first edge when both road-spent lanes reach it', () => {
    // A chain of the seat's own roads out of the candidate leaves both lanes live: the far end is
    // reached over own roads with the setup road still in hand, and again a ring around with the
    // road spent. The two lanes settle separately, so without a per-vertex guard the walk would
    // list that one site twice, at two costs, and `topTwo` would pair it with itself.
    const near = incidentEdges(CANDIDATE)[0]
    const neighbour = edgeEndpointVertexIds(near).find((vertexId) => vertexId !== CANDIDATE)!
    const far = incidentEdges(neighbour).find((edgeId) => edgeId !== near)!
    const farEnd = edgeEndpointVertexIds(far).find((vertexId) => vertexId !== neighbour)!
    const board = placeRoad(placeRoad(completeBoard(), near, 'me'), far, 'me')
    const occupancy = occupancyFromBoard(board, 'me')
    const byEdge = expansionSitesByEdge('standard4', occupancy, new Set([CANDIDATE]), CANDIDATE)

    const sites = byEdge.get(near) ?? []
    expect(sites.filter((site) => site.vertexId === farEnd))
      .toEqual([{ vertexId: farEnd, paidBuilds: 0, firstEdge: near }])
    for (const [edgeId, listed] of byEdge) {
      expect(new Set(listed.map((site) => site.vertexId)).size).toBe(listed.length)
      expect(listed.every((site) => site.firstEdge === edgeId)).toBe(true)
    }
  })

  it('is exactly inert at a weight of 0', () => {
    const off: EngineWeights = { ...DEFAULT_WEIGHTS, expansionWeight: 0 }
    const board = secondRing(CANDIDATE).reduce(
      (next, vertexId) => placeBuilding(next, vertexId, 'foe', 'settlement'),
      placeRoad(completeBoard(), incidentEdges(CANDIDATE)[0], 'foe'),
    )
    const ctx = computeBoardContext(board, off)
    const occupancy = occupancyFromBoard(board, 'me')
    const held = addToHoldings(ctx, emptyHoldings(), grid.vertexIds[0])
    for (const vertexId of grid.vertexIds) {
      const hand = ctx.stats.get(vertexId)?.setupGrant ?? null
      const breakdown = marginalBreakdown(ctx, held, vertexId, hand, occupancy)
      // Bits, not toBeCloseTo: the claim is that a zero weight cannot move a number.
      expect(breakdown.expansion).toBe(0)
      expect(breakdown).toEqual(marginalBreakdown(ctx, held, vertexId, hand, emptyOccupancy()))
      expect(marginalTotal(ctx, held, vertexId, hand, occupancy))
        .toBe(marginalWithoutExpansion(ctx, held, vertexId, hand))
    }
  })

  // M-66, the SP6 gate on `gate2`, adopted the term at 0.1, so the walk now runs on every score
  // the app takes. Pinned as a value rather than a range: the app and the simulator ship one
  // vector, and `simulator/placement/default-weights.json` carries the same number.
  it('ships on, at the weight the SP6 gate adopted', () => {
    expect(DEFAULT_WEIGHTS.expansionWeight).toBe(0.1)
    const board = completeBoard()
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const occupancy = occupancyFromBoard(board, 'me')
    const held = addToHoldings(ctx, emptyHoldings(), grid.vertexIds[0])
    // An open board opens sites everywhere, so the shipped weight has to move real scores.
    const moved = grid.vertexIds.filter((vertexId) => {
      const hand = ctx.stats.get(vertexId)?.setupGrant ?? null
      return marginalTotal(ctx, held, vertexId, hand, occupancy) !==
        marginalWithoutExpansion(ctx, held, vertexId, hand)
    })
    expect(moved.length).toBe(grid.vertexIds.length)
  })

  it('lays the road toward the best site, breaking ties on the pair then the edge id', () => {
    const board = completeBoard()
    const ctx = computeBoardContext(board, witness)
    const occupancy = occupancyFromBoard(board, 'me')
    const holdings = emptyHoldings()
    // Recompute the whole rule from the per-edge walk, on every candidate the board offers.
    for (const candidate of grid.vertexIds) {
      const byEdge = expansionSitesByEdge('standard4', occupancy, new Set([candidate]), candidate)
      const term = expansionTerm(ctx, holdings, occupancy, candidate)
      if (byEdge.size === 0) {
        expect(term).toEqual({ value: 0, road: null })
        continue
      }
      const held = addToHoldings(ctx, holdings, candidate)
      const ranked = [...byEdge].map(([edgeId, sites]) => {
        const values = sites
          .map((site) =>
            marginalWithoutExpansion(ctx, held, site.vertexId) *
              witness.expansionDecay ** site.paidBuilds)
          .sort((left, right) => right - left)
        return { edgeId, best: values[0], pair: values[0] + (values[1] ?? 0) }
      }).sort((left, right) =>
        right.best - left.best ||
        right.pair - left.pair ||
        (left.edgeId < right.edgeId ? -1 : 1))
      expect(term.road).toBe(ranked[0].edgeId)
    }
  })

  it('falls to the lowest edge id when every direction is worth the same', () => {
    // One tile and one token everywhere, and no decay, so distance costs nothing and every edge
    // out of an interior vertex reaches the same best site and the same best pair.
    const board = completeBoard(true)
    const weights = withWeights({ expansionWeight: 0.3, expansionDecay: 1 })
    const ctx = computeBoardContext(board, weights)
    const occupancy = occupancyFromBoard(board, 'me')
    const byEdge = expansionSitesByEdge('standard4', occupancy, new Set([CANDIDATE]), CANDIDATE)
    const edges = incidentEdges(CANDIDATE)
    expect([...byEdge.keys()].sort()).toEqual(edges)
    const held = addToHoldings(ctx, emptyHoldings(), CANDIDATE)
    const values = edges.map((edgeId) =>
      (byEdge.get(edgeId) ?? [])
        .map((site) => marginalWithoutExpansion(ctx, held, site.vertexId))
        .sort((left, right) => right - left)
        .slice(0, 2))
    // The tie is real, not an artefact of one edge happening to win.
    expect(values[1]).toEqual(values[0])
    expect(values[2]).toEqual(values[0])
    expect(expansionTerm(ctx, emptyHoldings(), occupancy, CANDIDATE).road).toBe(edges[0])
    // At the shipped decay the directions separate again, so the pin above is not vacuous.
    const decayed = computeBoardContext(board, withWeights({ expansionWeight: 0.3 }))
    expect(expansionTerm(decayed, emptyHoldings(), occupancy, 'v:0,-1;0,0;1,-1').road)
      .not.toBe(incidentEdges('v:0,-1;0,0;1,-1')[0])
  })
})
