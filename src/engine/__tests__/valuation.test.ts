import { describe, expect, it } from 'vitest'
import endgame from '../../parser/__tests__/expected/board-endgame-pieces.json'
import { createBoard, pips, setTile, vertexProduction } from '../../model/board'
import {
  axialKey,
  edgeEndpointVertexIds,
  vertexAdjacentVertexIds,
  vertexTouchingHexes,
} from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { RESOURCES, type Board, type Port, type Resource, type VertexId } from '../../model/types'
import { neutralModifier, type PlacementModifier } from '../modifiers'
import {
  addToHoldings,
  breakdownTotal,
  computeBoardContext,
  coverageValues,
  emptyHoldings,
  emptyOccupancy,
  marginalTotal,
  marginalBreakdown,
  occupancyFromBoard,
  scoreCandidate,
  type BoardContext,
  type Holdings,
  type PortAccess,
  type VertexStats,
} from '../valuation'
import { DEFAULT_WEIGHTS, type EngineWeights } from '../weights'

const vertices = boardGrid('standard4').vertexIds
const edgeIds = boardGrid('standard4').coastalEdgeIds

// A bare `Port` against a vertex means the settlement sits on it (full reach);
// pass a `PortAccess` to place it a road-build away instead.
const toAccess = (entry: Port | PortAccess): PortAccess =>
  'reach' in entry ? entry : { port: entry, reach: 1 }

function context(
  entries: readonly [VertexId, Partial<Record<Resource, number>>, (Port | PortAccess)[]?][],
  weights: EngineWeights = DEFAULT_WEIGHTS,
  scarcity: Partial<Record<Resource, number>> = {},
  robbed: ReadonlyMap<VertexId, Partial<Record<Resource, number>>> = new Map(),
): BoardContext {
  const stats = new Map<VertexId, VertexStats>()
  for (const [vertexId, pips, ports = []] of entries) {
    stats.set(vertexId, {
      pips,
      robbedPips: robbed.get(vertexId) ?? {},
      tokenPips: {},
      ports: ports.map(toAccess),
      setupGrant: {},
    })
  }
  const boardScarcity = {
    wood: scarcity.wood ?? 1,
    sheep: scarcity.sheep ?? 1,
    wheat: scarcity.wheat ?? 1,
    brick: scarcity.brick ?? 1,
    ore: scarcity.ore ?? 1,
  }
  return {
    stats,
    scarcity: boardScarcity,
    coverageValue: coverageValues(weights, boardScarcity),
    weights,
  }
}

const pairScore = (
  ctx: BoardContext,
  first: VertexId,
  second: VertexId,
  board: Board = createBoard('standard4'),
): number => {
  const firstScore = scoreCandidate(ctx, emptyHoldings(), first, 'aki', board, neutralModifier).total
  const holding = addToHoldings(ctx, emptyHoldings(), first)
  return firstScore +
    scoreCandidate(ctx, holding, second, 'aki', board, neutralModifier).total
}

describe('placement valuation', () => {
  it('keeps breakdown totals exact after a non-neutral modifier', () => {
    const vertexId = vertices[0]
    const ctx = context([[vertexId, { brick: 4, wheat: 3 }]])
    const modifier: PlacementModifier = (_playerId, breakdown) => ({
      ...breakdown,
      production: breakdown.production * 2,
    })
    const result = scoreCandidate(
      ctx,
      emptyHoldings(),
      vertexId,
      'aki',
      createBoard('standard4'),
      modifier,
    )
    expect(breakdownTotal(result.breakdown)).toBeCloseTo(result.total)
  })

  it('values equal pips more on the board-scarce resource', () => {
    const ctx = context(
      [[vertices[0], { wood: 5 }], [vertices[1], { brick: 5 }]],
      DEFAULT_WEIGHTS,
      { wood: 0.5, brick: 2 },
    )
    expect(marginalTotal(ctx, emptyHoldings(), vertices[1]))
      .toBeGreaterThan(marginalTotal(ctx, emptyHoldings(), vertices[0]))
  })

  it('prefers otherwise-equivalent 6+8 production over duplicate 6+6 production', () => {
    let board: Board = { ...createBoard('standard4'), ports: [] }
    const grid = boardGrid(board.layout)
    const usedHexes = new Set<string>()
    const sites: { vertexId: VertexId; coord: Board['hexes'][number]['coord'] }[] = []
    for (const vertexId of grid.vertexIds) {
      const land = vertexTouchingHexes(vertexId)
        .filter((coord) => grid.landKeys.has(axialKey(coord)))
      if (land.length !== 1 || usedHexes.has(axialKey(land[0]))) continue
      usedHexes.add(axialKey(land[0]))
      sites.push({ vertexId, coord: land[0] })
      if (sites.length === 4) break
    }
    expect(sites).toHaveLength(4)
    for (let index = 0; index < sites.length; index += 1) {
      board = setTile(board, sites[index].coord, 'wood', index === 3 ? 8 : 6)
    }
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const duplicateScore = pairScore(ctx, sites[0].vertexId, sites[1].vertexId, board)
    const variedScore = pairScore(ctx, sites[2].vertexId, sites[3].vertexId, board)
    const duplicateHoldings = addToHoldings(ctx, emptyHoldings(), sites[0].vertexId)
    expect(marginalTotal(ctx, duplicateHoldings, sites[1].vertexId))
      .toBeCloseTo(breakdownTotal(marginalBreakdown(
        ctx,
        duplicateHoldings,
        sites[1].vertexId,
      )))
    expect(variedScore).toBeGreaterThan(duplicateScore)
  })

  it('values a high-worth resource above an equal-pip low-worth one', () => {
    const ctx = context([[vertices[0], { wheat: 5 }], [vertices[1], { sheep: 5 }]])
    expect(marginalTotal(ctx, emptyHoldings(), vertices[0]))
      .toBeGreaterThan(marginalTotal(ctx, emptyHoldings(), vertices[1]))
  })

  it('credits a port only when matching production is a real surplus', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const weak = marginalBreakdown(
      context([[vertices[0], { wood: 3 }, [port]]]),
      emptyHoldings(),
      vertices[0],
    ).port
    const strong = marginalBreakdown(
      context([[vertices[0], { wood: 8 }, [port]]]),
      emptyHoldings(),
      vertices[0],
    ).port
    expect(weak).toBe(0)
    expect(strong).toBeGreaterThan(0)
  })

  // Pins the curve's shape, not just its direction: a linear curve would make
  // 1 pip worth exactly a quarter of 4 pips, so this fails if the exponent
  // regresses to 1. Both the spread and recipe terms scale with the same
  // coverage of the gating resource, so the ratio isolates the curve.
  it('makes coverage strongly sub-linear in pips', () => {
    const others: Partial<Record<Resource, number>> = {
      wood: DEFAULT_WEIGHTS.diversityCap,
      brick: DEFAULT_WEIGHTS.diversityCap,
      wheat: DEFAULT_WEIGHTS.diversityCap,
      ore: DEFAULT_WEIGHTS.diversityCap,
    }
    const sheepCredit = (pips: number): number => {
      const ctx = context([[vertices[0], others], [vertices[1], { sheep: pips }]])
      const holding = addToHoldings(ctx, emptyHoldings(), vertices[0])
      return marginalBreakdown(ctx, holding, vertices[1]).diversity
    }
    const token = sheepCredit(1)
    const full = sheepCredit(DEFAULT_WEIGHTS.diversityCap)
    expect(full).toBeGreaterThan(0)
    expect(token / full).toBeLessThan(0.2)
  })

  it('values a pip of a board-scarce resource above an abundant one', () => {
    // Exercises computeBoardContext's own scarcity formula rather than a
    // hand-injected one, so inverting it fails here.
    let board: Board = { ...createBoard('standard4'), ports: [] }
    const grid = boardGrid(board.layout)
    const coords = board.hexes.map((hex) => hex.coord)
    // Wood everywhere (abundant), one lone brick hex (scarce), equal tokens.
    for (const coord of coords) board = setTile(board, coord, 'wood', 6)
    board = setTile(board, coords[0], 'brick', 6)
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    expect(ctx.scarcity.brick).toBeGreaterThan(ctx.scarcity.wood)
    // Compare corners touching a single land hex, so both sides are 6 pips of
    // one resource and only the board-scarcity term can separate them.
    const singleHexPips = pips(6)
    const singleHexVertex = (resource: Resource): VertexId | undefined =>
      grid.vertexIds.find((vertexId) => {
        const production = vertexProduction(board, vertexId)
        return Object.keys(production).length === 1 &&
          (production[resource] ?? 0) === singleHexPips
      })
    const brickOnly = singleHexVertex('brick')
    const woodOnly = singleHexVertex('wood')
    expect(brickOnly).toBeDefined()
    expect(woodOnly).toBeDefined()
    const value = (vertexId: VertexId): number => {
      const breakdown = marginalBreakdown(ctx, emptyHoldings(), vertexId)
      return breakdown.production + breakdown.scarcity
    }
    expect(value(brickOnly!)).toBeGreaterThan(value(woodOnly!))
  })

  // When a pair has to be broken up, the board decides which half to keep: the
  // abundant one is the cheaper skip because opponents will trade it away.
  it('costs less to skip the resource the board is flush with', () => {
    const ctx = context(
      [
        [vertices[0], { wheat: 4, sheep: 4, ore: 4 }],
        [vertices[1], { wood: 4 }], // keeps wood, skips the scarce brick
        [vertices[2], { brick: 4 }], // keeps brick, skips the abundant wood
      ],
      DEFAULT_WEIGHTS,
      { wood: 0.5, brick: 2 },
    )
    // Equal pips of equally-valued resources, and neither completes a recipe,
    // so only the cost of the resource left uncovered separates them.
    expect(DEFAULT_WEIGHTS.resourceValue.wood).toBe(DEFAULT_WEIGHTS.resourceValue.brick)
    const holding = addToHoldings(ctx, emptyHoldings(), vertices[0])
    const skipBrick = marginalBreakdown(ctx, holding, vertices[1]).diversity
    const skipWood = marginalBreakdown(ctx, holding, vertices[2]).diversity
    expect(skipWood).toBeGreaterThan(skipBrick)
  })

  it('barely rewards a fifth resource reachable only on a lone 2/12 token', () => {
    const ctx = context([
      [vertices[0], { wood: 4, brick: 4, wheat: 4, ore: 4 }],
      [vertices[1], { sheep: 1 }], // a lone 2 or 12 — nearly never rolls
      [vertices[2], { sheep: 3 }], // a genuine source (e.g. a 4 or 10)
    ])
    const holding = addToHoldings(ctx, emptyHoldings(), vertices[0])
    const tokenDiv = marginalBreakdown(ctx, holding, vertices[1]).diversity
    const realDiv = marginalBreakdown(ctx, holding, vertices[2]).diversity
    expect(realDiv).toBeGreaterThan(tokenDiv * 2)
  })

  it('reads numeric port rates and orders 2:1 above 3:1 above 4:1', () => {
    const vertexId = vertices[0]
    const scoreAt = (rate: number) => {
      const port = { edgeId: edgeIds[0], resource: 'wood' as const, rate }
      return marginalBreakdown(context([[vertexId, { wood: 8 }, [port]]]), emptyHoldings(), vertexId).port
    }
    expect(scoreAt(2)).toBeGreaterThan(scoreAt(3))
    expect(scoreAt(3)).toBeGreaterThan(scoreAt(4))
    expect(scoreAt(4)).toBe(0)
  })

  // Exercises the BFS in computeBoardContext, not just the scoring of a reach
  // value: a vertex one road out cannot settle the endpoint it neighbours
  // (distance rule), so it pays the same two roads as a vertex two out.
  it('charges two roads to reach a port from anywhere off its edge', () => {
    const board = createBoard('standard4')
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const port = board.ports[0]
    const reachFor = (vertexId: VertexId): number | undefined =>
      ctx.stats.get(vertexId)?.ports
        .find((access) => access.port.edgeId === port.edgeId)?.reach
    for (const endpoint of edgeEndpointVertexIds(port.edgeId)) {
      expect(reachFor(endpoint)).toBe(1)
    }
    const offEdge = [...ctx.stats]
      .filter(([vertexId]) => !edgeEndpointVertexIds(port.edgeId).includes(vertexId))
      .map(([vertexId]) => reachFor(vertexId))
      .filter((reach): reach is number => reach !== undefined)
    expect(offEdge.length).toBeGreaterThan(0)
    for (const reach of offEdge) {
      expect(reach).toBe(DEFAULT_WEIGHTS.nearPortDecay ** 2)
    }
  })

  it('decays port reach with each road-build of distance', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const scoreAtReach = (reach: number): number =>
      marginalBreakdown(
        context([[vertices[0], { wood: 8 }, [{ port, reach }]]]),
        emptyHoldings(),
        vertices[0],
      ).port
    const onPort = scoreAtReach(1)
    const oneRoad = scoreAtReach(DEFAULT_WEIGHTS.nearPortDecay)
    const twoRoads = scoreAtReach(DEFAULT_WEIGHTS.nearPortDecay ** 2)
    expect(onPort).toBeGreaterThan(oneRoad)
    expect(oneRoad).toBeGreaterThan(twoRoads)
    expect(twoRoads).toBeGreaterThan(0)
  })

  it('keeps the closest access when two settlements reach one port', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'ore', rate: 2 }
    const ctx = context([
      [vertices[0], { ore: 4 }, [{ port, reach: 0.25 }]],
      [vertices[1], { ore: 4 }, [{ port, reach: 1 }]],
    ])
    const holding = addToHoldings(
      ctx,
      addToHoldings(ctx, emptyHoldings(), vertices[0]),
      vertices[1],
    )
    expect(holding.ports).toEqual([{ port, reach: 1 }])
  })

  it('does not stack duplicate or overlapping port capabilities', () => {
    const firstPort: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const secondPort: Port = { edgeId: edgeIds[1], resource: 'wood', rate: 2 }
    const genericPort: Port = { edgeId: edgeIds[2], resource: null, rate: 3 }
    const first = vertices[0]
    const second = vertices[1]
    const baseEntries: [VertexId, Partial<Record<Resource, number>>, Port[]][] = [
      [first, { wood: 6 }, [firstPort]],
      [second, { wood: 2 }, []],
    ]
    const duplicateCtx = context([
      baseEntries[0],
      [second, { wood: 2 }, [secondPort]],
    ])
    const noDuplicateCtx = context(baseEntries)
    const duplicateHolding = addToHoldings(duplicateCtx, emptyHoldings(), first)
    const plainHolding = addToHoldings(noDuplicateCtx, emptyHoldings(), first)
    expect(marginalBreakdown(duplicateCtx, duplicateHolding, second).port)
      .toBeCloseTo(marginalBreakdown(noDuplicateCtx, plainHolding, second).port)

    const genericCtx = context([
      baseEntries[0],
      [second, { wood: 2 }, [genericPort]],
    ])
    const genericHolding = addToHoldings(genericCtx, emptyHoldings(), first)
    expect(marginalBreakdown(genericCtx, genericHolding, second).port)
      .toBeCloseTo(marginalBreakdown(noDuplicateCtx, plainHolding, second).port)
  })

  it('lets a generic port hedge all resources at a discount', () => {
    const generic: Port = { edgeId: edgeIds[0], resource: null, rate: 3 }
    const dedicated: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const genericCtx = context([[vertices[0], { wood: 4, ore: 4 }, [generic]]])
    const dedicatedCtx = context([[vertices[0], { wood: 8 }, [dedicated]]])
    const genericValue = marginalBreakdown(genericCtx, emptyHoldings(), vertices[0]).port
    const dedicatedValue = marginalBreakdown(dedicatedCtx, emptyHoldings(), vertices[0]).port
    expect(genericValue).toBeGreaterThan(0)
    expect(dedicatedValue).toBeGreaterThan(genericValue)
  })

  it('prices the ore/wheat/sheep recipe only at a nonzero recipeDevCardBonus', () => {
    // Hand arithmetic at DEFAULT_WEIGHTS on a vertex with no wood and no brick,
    // so the road and settlement recipes are both zero and only the spread, the
    // city recipe and the dev-card recipe are left. recipeCap and diversityCap
    // are both 4, so coverage is (min(pips, 4) / 4) ** 1.5: ore and wheat
    // saturate at 1 and sheep, at 3 pips, sits at 0.75 ** 1.5. Board scarcity is
    // flat, so each resource's coverage value is its raw resourceValue.
    const sheepCover = 0.75 ** 1.5
    const spread = 1.6 * (1.3 * 1 + 1.35 * 1 + 0.75 * sheepCover)
    const city = 2 * 1
    const pips = { ore: 4, wheat: 4, sheep: 3 }
    const off = { ...DEFAULT_WEIGHTS, recipeDevCardBonus: 0 }
    const on = { ...DEFAULT_WEIGHTS, recipeDevCardBonus: 2 }
    expect(
      marginalBreakdown(context([[vertices[0], pips]], off), emptyHoldings(), vertices[0]).diversity,
    ).toBeCloseTo(spread + city, 12)
    expect(
      marginalBreakdown(context([[vertices[0], pips]], on), emptyHoldings(), vertices[0]).diversity,
    ).toBeCloseTo(spread + city + 2 * sheepCover, 12)
  })

  it('ships the dev-card recipe at zero, so it moves no shipped score', () => {
    // The same vertex as the test above, read at DEFAULT_WEIGHTS: the shipped diversity must
    // still be the spread plus the city recipe alone, with no dev-card contribution. Comparing
    // against a weights object that also sets the bonus to 0 would be a comparison with itself.
    const sheepCover = 0.75 ** 1.5
    const spread = 1.6 * (1.3 * 1 + 1.35 * 1 + 0.75 * sheepCover)
    const city = 2 * 1
    expect(DEFAULT_WEIGHTS.recipeDevCardBonus).toBe(0)
    expect(
      marginalBreakdown(
        context([[vertices[0], { ore: 4, wheat: 4, sheep: 3 }]]),
        emptyHoldings(),
        vertices[0],
      ).diversity,
    ).toBeCloseTo(spread + city, 12)
  })

  it('pays a port more to a narrow spread than to a broad one at equal production', () => {
    // Hand arithmetic at DEFAULT_WEIGHTS plus the witness weight. A dedicated
    // 2:1 port has portFactor 1 and empty holdings carry no port, so the whole
    // delta is the post-move half: portWeight (0.55) * portSurplus(8) (8 - 3)
    // * 1 * (1 + weight * deficit). recipeCap is 4, so 4 pips saturate a
    // resource's coverage at 1: the narrow pair covers none of the other four
    // (deficit 1) and the broad pair covers all four (deficit 0).
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const weights = { ...DEFAULT_WEIGHTS, portCoverageDeficitWeight: 1 }
    const narrow = context([[vertices[0], { wood: 8 }, [port]]], weights)
    const broad = context(
      [[vertices[0], { wood: 8, sheep: 4, wheat: 4, brick: 4, ore: 4 }, [port]]],
      weights,
    )
    expect(marginalBreakdown(narrow, emptyHoldings(), vertices[0]).port)
      .toBeCloseTo(0.55 * 5 * 2, 12)
    expect(marginalBreakdown(broad, emptyHoldings(), vertices[0]).port)
      .toBeCloseTo(0.55 * 5 * 1, 12)
  })

  it('prices each half of the port delta at its own coverage deficit', () => {
    // The holding sits on the port with 6 wood and nothing else, so before the
    // move wood's deficit is 1 and its factor 2. The candidate adds 4 wood and
    // 4 sheep, so after the move sheep is saturated too: one of the other four
    // is covered, the deficit is 0.75 and the factor 1.75. A true delta is
    // 0.55 * (portSurplus(10) * 1.75 - portSurplus(6) * 2); repricing the
    // holding's existing port at either single factor gives 3.85 or 4.4.
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const ctx = context(
      [
        [vertices[0], { wood: 4, sheep: 4 }],
        [vertices[1], { wood: 6 }, [port]],
      ],
      { ...DEFAULT_WEIGHTS, portCoverageDeficitWeight: 1 },
    )
    const holding = addToHoldings(ctx, emptyHoldings(), vertices[1])
    expect(marginalBreakdown(ctx, holding, vertices[0]).port)
      .toBeCloseTo(0.55 * (7 * 1.75 - 3 * 2), 12)
  })

  it('ships the port coverage deficit at zero, leaving the port delta unchanged', () => {
    // The same holding and candidate as above at the shipped default, where
    // every factor is 1 and the delta is the pre-change arithmetic:
    // portWeight * (portSurplus(6 + 4) * 1 - portSurplus(6) * 1).
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const ctx = context([
      [vertices[0], { wood: 4, sheep: 4 }],
      [vertices[1], { wood: 6 }, [port]],
    ])
    const shipped = marginalBreakdown(
      ctx,
      addToHoldings(ctx, emptyHoldings(), vertices[1]),
      vertices[0],
    )
    expect(DEFAULT_WEIGHTS.portCoverageDeficitWeight).toBe(0)
    expect(shipped.port).toBeCloseTo(0.55 * (7 - 3), 12)
  })

  it('dedupes one port edge across a two-vertex holding', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'ore', rate: 2 }
    const ctx = context([
      [vertices[0], { ore: 4 }, [port]],
      [vertices[1], { ore: 4 }, [port]],
    ])
    const holding = addToHoldings(
      ctx,
      addToHoldings(ctx, emptyHoldings(), vertices[0]),
      vertices[1],
    )
    expect(holding.ports).toEqual([{ port, reach: 1 }])
  })

  it('isolates robberDiscount in the robber component when other adjusted bonuses are disabled', () => {
    const vertexId = vertices[0]
    const robbed = new Map([[vertexId, { wood: 5 }]])
    const weights = {
      ...DEFAULT_WEIGHTS,
      scarcityWeight: 0,
      diversityWeight: 0,
      recipeRoadBonus: 0,
      recipeCityBonus: 0,
      recipeSettlementBonus: 0,
      portWeight: 0,
    }
    const discounted = marginalBreakdown(
      context([[vertexId, { wood: 5 }]], weights, {}, robbed),
      emptyHoldings(),
      vertexId,
    )
    const ignored = marginalBreakdown(
      context([[vertexId, { wood: 5 }]], { ...weights, robberDiscount: 0 }, {}, robbed),
      emptyHoldings(),
      vertexId,
    )
    expect(discounted.robber).toBe(-5 * DEFAULT_WEIGHTS.robberDiscount)
    expect(ignored.robber).toBe(0)
    expect({ ...discounted, robber: 0 }).toEqual({ ...ignored, robber: 0 })
  })

  it('keeps the neutral modifier identity and lets a modifier boost brick spots', () => {
    const brick = vertices[0]
    const wood = vertices[1]
    const ctx = context([[brick, { brick: 5 }], [wood, { wood: 5 }]])
    const breakdown = marginalBreakdown(ctx, emptyHoldings(), brick)
    expect(neutralModifier('aki', breakdown, {
      board: createBoard('standard4'),
      vertexId: brick,
      held: [],
      weights: DEFAULT_WEIGHTS,
    })).toBe(breakdown)
    const brickBoost: PlacementModifier = (_playerId, value, modifierCtx) =>
      modifierCtx.vertexId === brick ? { ...value, production: value.production * 2 } : value
    expect(scoreCandidate(
      ctx,
      emptyHoldings(),
      brick,
      'aki',
      createBoard('standard4'),
      brickBoost,
    ).total).toBeGreaterThan(scoreCandidate(
      ctx,
      emptyHoldings(),
      wood,
      'aki',
      createBoard('standard4'),
      brickBoost,
    ).total)
  })

  it('keeps the allocation-free fast path equal to the full breakdown', () => {
    const ctx = context([
      [vertices[0], { wood: 4, brick: 3 }],
      [vertices[1], { wheat: 5, sheep: 2 }],
    ])
    const holding: Holdings = addToHoldings(ctx, emptyHoldings(), vertices[0])
    expect(marginalTotal(ctx, holding, vertices[1]))
      .toBeCloseTo(breakdownTotal(marginalBreakdown(ctx, holding, vertices[1])))
  })

  // The helper above builds a bare context, so marginalTotal takes its
  // recompute fallback. Only a real computeBoardContext populates the
  // precomputed per-vertex cache, so exercise that branch too.
  it('keeps the precomputed fast path equal to the full breakdown', () => {
    let board: Board = createBoard('standard4')
    for (let index = 0; index < board.hexes.length; index += 1) {
      board = setTile(
        board,
        board.hexes[index].coord,
        RESOURCES[index % RESOURCES.length],
        [6, 8, 5, 9, 4, 10, 3, 11, 2, 12][index % 10],
      )
    }
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const grid = boardGrid(board.layout)
    const holding = addToHoldings(ctx, emptyHoldings(), grid.vertexIds[0])
    for (const vertexId of grid.vertexIds) {
      expect(marginalTotal(ctx, holding, vertexId))
        .toBeCloseTo(breakdownTotal(marginalBreakdown(ctx, holding, vertexId)))
    }
  })

  it('calibrates a 12-pip wood port pair to beat diversity by at least 1.5', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const ctx = context([
      [vertices[0], { wood: 6 }, [port]],
      [vertices[1], { wood: 6 }],
      [vertices[2], { wood: 2, brick: 3 }],
      [vertices[3], { wheat: 2, sheep: 3 }],
    ])
    expect(pairScore(ctx, vertices[0], vertices[1]) - pairScore(ctx, vertices[2], vertices[3]))
      .toBeGreaterThanOrEqual(1.5)
  })

  it('calibrates diversity to beat an 8-pip concentration by at least 1.5', () => {
    const port: Port = { edgeId: edgeIds[0], resource: 'wood', rate: 2 }
    const ctx = context([
      [vertices[0], { wood: 4 }, [port]],
      [vertices[1], { wood: 4 }],
      [vertices[2], { wood: 2, brick: 3 }],
      [vertices[3], { wheat: 2, sheep: 3 }],
    ])
    expect(pairScore(ctx, vertices[2], vertices[3]) - pairScore(ctx, vertices[0], vertices[1]))
      .toBeGreaterThanOrEqual(1.5)
  })
})

describe('occupancy', () => {
  const board = endgame as Board

  it('records the buildings and roads a board carries', () => {
    const occupancy = occupancyFromBoard(board)
    expect(occupancy.blocked.size).toBe(board.buildings.length)
    for (const building of board.buildings) {
      expect(occupancy.blocked.has(building.vertexId)).toBe(true)
    }
    expect(occupancy.edgeOwner.size).toBe(board.roads.length)
    for (const road of board.roads) {
      expect(occupancy.edgeOwner.get(road.edgeId)).toBe(road.playerId)
    }
    // The vertices a building bars under the distance rule are not in the set: a walk has to be
    // able to tell a settlement apart from its neighbour.
    const neighbours = board.buildings.flatMap((building) =>
      vertexAdjacentVertexIds(building.vertexId))
    const occupied = new Set(board.buildings.map((building) => building.vertexId))
    expect(neighbours.some((vertexId) => occupancy.blocked.has(vertexId) &&
      !occupied.has(vertexId))).toBe(false)
  })

  it('empties to a shared value and memoizes per board', () => {
    expect(emptyOccupancy().blocked.size).toBe(0)
    expect(emptyOccupancy().edgeOwner.size).toBe(0)
    expect(emptyOccupancy()).toBe(emptyOccupancy())
    expect(occupancyFromBoard(board)).toBe(occupancyFromBoard(board))
    expect(occupancyFromBoard({ ...board })).not.toBe(occupancyFromBoard(board))
  })

  // Nothing reads occupancy until SP3's expansion term does, so a full one has to score bit-for-bit
  // what an empty one scores. Bits, not toBeCloseTo: the claim is that the argument is inert.
  it('leaves every score untouched at every scoring entry', () => {
    const ctx = computeBoardContext(board, DEFAULT_WEIGHTS)
    const occupancy = occupancyFromBoard(board)
    const grid = boardGrid(board.layout)
    const holding = addToHoldings(ctx, emptyHoldings(), grid.vertexIds[0])
    for (const vertexId of grid.vertexIds) {
      const hand = ctx.stats.get(vertexId)?.setupGrant ?? null
      expect(marginalBreakdown(ctx, holding, vertexId, hand, occupancy))
        .toEqual(marginalBreakdown(ctx, holding, vertexId, hand))
      expect(marginalTotal(ctx, holding, vertexId, hand, occupancy))
        .toBe(marginalTotal(ctx, holding, vertexId, hand))
      expect(scoreCandidate(
        ctx,
        holding,
        vertexId,
        'p1',
        board,
        neutralModifier,
        hand,
        occupancy,
      )).toEqual(scoreCandidate(ctx, holding, vertexId, 'p1', board, neutralModifier, hand))
    }
  })
})
