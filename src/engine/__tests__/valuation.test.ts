import { describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import type { Port, Resource, VertexId } from '../../model/types'
import { neutralModifier, type PlacementModifier } from '../modifiers'
import {
  addToHoldings,
  breakdownTotal,
  emptyHoldings,
  fastMarginalTotal,
  marginalBreakdown,
  scoreCandidate,
  type BoardContext,
  type Holdings,
  type VertexStats,
} from '../valuation'
import { DEFAULT_WEIGHTS, type EngineWeights } from '../weights'

const vertices = boardGrid('standard4').vertexIds
const edgeIds = boardGrid('standard4').coastalEdgeIds

function context(
  entries: readonly [VertexId, Partial<Record<Resource, number>>, Port[]?][],
  weights: EngineWeights = DEFAULT_WEIGHTS,
  scarcity: Partial<Record<Resource, number>> = {},
  robbed: ReadonlyMap<VertexId, Partial<Record<Resource, number>>> = new Map(),
): BoardContext {
  const stats = new Map<VertexId, VertexStats>()
  for (const [vertexId, pips, ports = []] of entries) {
    stats.set(vertexId, { pips, robbedPips: robbed.get(vertexId) ?? {}, ports })
  }
  return {
    stats,
    scarcity: {
      wood: scarcity.wood ?? 1,
      sheep: scarcity.sheep ?? 1,
      wheat: scarcity.wheat ?? 1,
      brick: scarcity.brick ?? 1,
      ore: scarcity.ore ?? 1,
    },
    weights,
  }
}

const pairScore = (ctx: BoardContext, first: VertexId, second: VertexId): number => {
  const firstScore = scoreCandidate(
    ctx,
    emptyHoldings(),
    first,
    'aki',
    createBoard('standard4'),
    neutralModifier,
  ).total
  const holding = addToHoldings(ctx, emptyHoldings(), first)
  return firstScore + scoreCandidate(
    ctx,
    holding,
    second,
    'aki',
    createBoard('standard4'),
    neutralModifier,
  ).total
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
    expect(fastMarginalTotal(ctx, emptyHoldings(), vertices[1]))
      .toBeGreaterThan(fastMarginalTotal(ctx, emptyHoldings(), vertices[0]))
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
    expect(holding.ports).toEqual([port])
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
    expect(fastMarginalTotal(ctx, holding, vertices[1]))
      .toBeCloseTo(breakdownTotal(marginalBreakdown(ctx, holding, vertices[1])))
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
