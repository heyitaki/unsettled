import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import { pips, vertexProduction } from '../model/board'
import { boardGrid } from '../model/layouts'
import { RESOURCES, type Board, type Port, type Resource, type VertexId } from '../model/types'
import type { PlacementModifier } from './modifiers'
import type { EngineWeights } from './weights'

export interface ScoreBreakdown {
  production: number
  scarcity: number
  robber: number
  diversity: number
  port: number
}

export const breakdownTotal = (breakdown: ScoreBreakdown): number =>
  breakdown.production +
  breakdown.scarcity +
  breakdown.robber +
  breakdown.diversity +
  breakdown.port

export interface VertexStats {
  pips: Partial<Record<Resource, number>>
  robbedPips: Partial<Record<Resource, number>>
  tokenPips: Partial<Record<number, number>>
  ports: Port[]
}

export interface BoardContext {
  stats: ReadonlyMap<VertexId, VertexStats>
  scarcity: Record<Resource, number>
  weights: EngineWeights
}

export interface Holdings {
  vertices: VertexId[]
  pips: Partial<Record<Resource, number>>
  tokenPips: Partial<Record<number, number>>
  ports: Port[]
}

interface FastVertexStats {
  adjustedBrick: number
  adjustedOre: number
  adjustedSheep: number
  adjustedWheat: number
  adjustedWood: number
  base: number
}

const fastContexts = new WeakMap<BoardContext, ReadonlyMap<VertexId, FastVertexStats>>()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export function computeBoardContext(board: Board, weights: EngineWeights): BoardContext {
  const boardPips: Record<Resource, number> = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
  const hexesByKey = new Map(board.hexes.map((hex) => [axialKey(hex.coord), hex]))
  for (const hex of board.hexes) {
    if (hex.tile === null || hex.tile === 'desert') continue
    boardPips[hex.tile] += pips(hex.numberToken)
  }
  const meanPips = RESOURCES.reduce((sum, resource) => sum + boardPips[resource], 0) / RESOURCES.length
  const scarcity = Object.fromEntries(
    RESOURCES.map((resource) => [
      resource,
      clamp(meanPips / Math.max(boardPips[resource], 1), weights.scarcityClampMin, weights.scarcityClampMax),
    ]),
  ) as Record<Resource, number>

  const portsByVertex = new Map<VertexId, Port[]>()
  for (const port of board.ports) {
    for (const vertexId of edgeEndpointVertexIds(port.edgeId)) {
      const ports = portsByVertex.get(vertexId)
      if (ports) ports.push(port)
      else portsByVertex.set(vertexId, [port])
    }
  }
  const robberKey = board.robber === null ? null : axialKey(board.robber)
  const stats = new Map<VertexId, VertexStats>()
  for (const vertexId of boardGrid(board.layout).vertexIds) {
    const touching = new Set(vertexTouchingHexes(vertexId).map(axialKey))
    const robbedPips: Partial<Record<Resource, number>> = {}
    const tokenPips: Partial<Record<number, number>> = {}
    for (const key of touching) {
      const hex = hexesByKey.get(key)
      if (!hex || hex.tile === null || hex.tile === 'desert' || hex.numberToken === null) {
        continue
      }
      const amount = pips(hex.numberToken)
      if (amount > 0) tokenPips[hex.numberToken] = (tokenPips[hex.numberToken] ?? 0) + amount
    }
    if (robberKey !== null && touching.has(robberKey)) {
      const hex = hexesByKey.get(robberKey)
      if (hex?.tile && hex.tile !== 'desert') robbedPips[hex.tile] = pips(hex.numberToken)
    }
    stats.set(vertexId, {
      pips: vertexProduction(board, vertexId),
      robbedPips,
      tokenPips,
      ports: portsByVertex.get(vertexId) ?? [],
    })
  }
  const ctx = { stats, scarcity, weights }
  const fastStats = new Map<VertexId, FastVertexStats>()
  for (const [vertexId, vertexStats] of stats) {
    let base = 0
    for (const resource of RESOURCES) {
      const raw = vertexStats.pips[resource] ?? 0
      const robbed = vertexStats.robbedPips[resource] ?? 0
      const adjusted = raw - robbed * weights.robberDiscount
      base += raw -
        robbed * weights.robberDiscount +
        adjusted * weights.scarcityWeight * (scarcity[resource] - 1)
    }
    fastStats.set(vertexId, {
      adjustedBrick: adjustedPips(ctx, vertexStats, 'brick'),
      adjustedOre: adjustedPips(ctx, vertexStats, 'ore'),
      adjustedSheep: adjustedPips(ctx, vertexStats, 'sheep'),
      adjustedWheat: adjustedPips(ctx, vertexStats, 'wheat'),
      adjustedWood: adjustedPips(ctx, vertexStats, 'wood'),
      base,
    })
  }
  fastContexts.set(ctx, fastStats)
  return ctx
}

export const emptyHoldings = (): Holdings => ({ vertices: [], pips: {}, tokenPips: {}, ports: [] })

const adjustedPips = (ctx: BoardContext, stats: VertexStats, resource: Resource): number =>
  (stats.pips[resource] ?? 0) -
  (stats.robbedPips[resource] ?? 0) * ctx.weights.robberDiscount

export function addToHoldings(ctx: BoardContext, holdings: Holdings, vertexId: VertexId): Holdings {
  const stats = ctx.stats.get(vertexId)
  if (!stats) return holdings
  const nextPips = { ...holdings.pips }
  for (const resource of RESOURCES) {
    const amount = adjustedPips(ctx, stats, resource)
    if (amount !== 0) nextPips[resource] = (nextPips[resource] ?? 0) + amount
  }
  const tokenPips = { ...holdings.tokenPips }
  for (const token in stats.tokenPips) {
    const number = Number(token)
    tokenPips[number] = (tokenPips[number] ?? 0) + (stats.tokenPips[number] ?? 0)
  }
  const edgeIds = new Set(holdings.ports.map((port) => port.edgeId))
  const ports = [...holdings.ports]
  for (const port of stats.ports) {
    if (edgeIds.has(port.edgeId)) continue
    edgeIds.add(port.edgeId)
    ports.push(port)
  }
  return { vertices: [...holdings.vertices, vertexId], pips: nextPips, tokenPips, ports }
}

const diversityScore = (
  weights: EngineWeights,
  pipsFor: (resource: Resource) => number,
): number => {
  let score = 0
  for (const resource of RESOURCES) {
    score += weights.diversityWeight * Math.min(pipsFor(resource), weights.diversityCap) / weights.diversityCap
  }
  const recipe = (resources: readonly Resource[], bonus: number): number =>
    bonus * Math.min(...resources.map((resource) =>
      Math.min(pipsFor(resource), weights.recipeCap) / weights.recipeCap))
  return score +
    recipe(['wood', 'brick'], weights.recipeRoadBonus) +
    recipe(['ore', 'wheat'], weights.recipeCityBonus) +
    recipe(['wood', 'brick', 'wheat', 'sheep'], weights.recipeSettlementBonus)
}

const portFactor = (rate: number): number =>
  Math.max(0, 1 / rate - 1 / 4) / (1 / 2 - 1 / 4)

function effectivePortFactor(
  ports: readonly Port[],
  resource: Resource,
  genericPortFactor: number,
  extraPorts: readonly Port[] = [],
): number {
  let dedicated = 0
  let generic = 0
  for (const port of ports) {
    const factor = portFactor(port.rate)
    if (port.resource === resource) dedicated = Math.max(dedicated, factor)
    else if (port.resource === null) generic = Math.max(generic, factor)
  }
  for (const port of extraPorts) {
    const factor = portFactor(port.rate)
    if (port.resource === resource) dedicated = Math.max(dedicated, factor)
    else if (port.resource === null) generic = Math.max(generic, factor)
  }
  return Math.max(dedicated, genericPortFactor * generic)
}

function portScore(
  weights: EngineWeights,
  pipsFor: (resource: Resource) => number,
  ports: readonly Port[],
  extraPorts: readonly Port[] = [],
): number {
  let score = 0
  for (const resource of RESOURCES) {
    score += pipsFor(resource) *
      effectivePortFactor(ports, resource, weights.genericPortFactor, extraPorts)
  }
  return score * weights.portWeight
}

function fastDiversityScore(
  weights: EngineWeights,
  wood: number,
  sheep: number,
  wheat: number,
  brick: number,
  ore: number,
): number {
  const spread = weights.diversityWeight * (
    Math.min(wood, weights.diversityCap) +
    Math.min(sheep, weights.diversityCap) +
    Math.min(wheat, weights.diversityCap) +
    Math.min(brick, weights.diversityCap) +
    Math.min(ore, weights.diversityCap)
  ) / weights.diversityCap
  const road = weights.recipeRoadBonus *
    Math.min(Math.min(wood, weights.recipeCap), Math.min(brick, weights.recipeCap)) /
    weights.recipeCap
  const city = weights.recipeCityBonus *
    Math.min(Math.min(ore, weights.recipeCap), Math.min(wheat, weights.recipeCap)) /
    weights.recipeCap
  const settlement = weights.recipeSettlementBonus * Math.min(
    Math.min(wood, weights.recipeCap),
    Math.min(brick, weights.recipeCap),
    Math.min(wheat, weights.recipeCap),
    Math.min(sheep, weights.recipeCap),
  ) / weights.recipeCap
  return spread + road + city + settlement
}

function fastPortScore(
  weights: EngineWeights,
  ports: readonly Port[],
  extraPorts: readonly Port[],
  wood: number,
  sheep: number,
  wheat: number,
  brick: number,
  ore: number,
): number {
  return weights.portWeight * (
    wood * effectivePortFactor(ports, 'wood', weights.genericPortFactor, extraPorts) +
    sheep * effectivePortFactor(ports, 'sheep', weights.genericPortFactor, extraPorts) +
    wheat * effectivePortFactor(ports, 'wheat', weights.genericPortFactor, extraPorts) +
    brick * effectivePortFactor(ports, 'brick', weights.genericPortFactor, extraPorts) +
    ore * effectivePortFactor(ports, 'ore', weights.genericPortFactor, extraPorts)
  )
}

function duplicateNumberPenalty(
  weights: EngineWeights,
  holdings: Holdings,
  candidate: VertexStats,
): number {
  let overlap = 0
  for (const token in candidate.tokenPips) {
    const number = Number(token)
    overlap += Math.min(
      holdings.tokenPips[number] ?? 0,
      candidate.tokenPips[number] ?? 0,
    )
  }
  return overlap * weights.duplicateNumberPenalty
}

function componentValues(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
): [number, number, number, number, number] {
  const stats = ctx.stats.get(candidate)
  if (!stats) return [0, 0, 0, 0, 0]
  let production = 0
  let scarcity = 0
  let robber = 0
  for (const resource of RESOURCES) {
    const raw = stats.pips[resource] ?? 0
    const robbed = stats.robbedPips[resource] ?? 0
    const adjusted = raw - robbed * ctx.weights.robberDiscount
    production += raw
    scarcity += adjusted * ctx.weights.scarcityWeight * (ctx.scarcity[resource] - 1)
    robber -= robbed * ctx.weights.robberDiscount
  }

  const beforePips = (resource: Resource) => holdings.pips[resource] ?? 0
  const afterPips = (resource: Resource) =>
    beforePips(resource) + adjustedPips(ctx, stats, resource)

  // Expected payout is linear, but same-number income is fully correlated,
  // lumpier, and vulnerable to one robber-blockable number.
  const diversity = diversityScore(ctx.weights, afterPips) -
    diversityScore(ctx.weights, beforePips) -
    duplicateNumberPenalty(ctx.weights, holdings, stats)

  // Port value uses full production; the conservative weight stands in for consumption.
  const port = portScore(ctx.weights, afterPips, holdings.ports, stats.ports) -
    portScore(ctx.weights, beforePips, holdings.ports)
  return [production, scarcity, robber, diversity, port]
}

export function marginalBreakdown(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
): ScoreBreakdown {
  const [production, scarcity, robber, diversity, port] = componentValues(ctx, holdings, candidate)
  return { production, scarcity, robber, diversity, port }
}

/**
 * Allocation-free neutral score used by rollout scans. Exported so parity with
 * the object form stays testable.
 */
export function fastMarginalTotal(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
): number {
  const stats = ctx.stats.get(candidate)
  if (!stats) return 0
  const weights = ctx.weights
  const fast = fastContexts.get(ctx)?.get(candidate)
  let base = fast?.base ?? 0
  if (!fast) {
    for (const resource of RESOURCES) {
      const raw = stats.pips[resource] ?? 0
      const robbed = stats.robbedPips[resource] ?? 0
      const adjusted = raw - robbed * weights.robberDiscount
      base += raw -
        robbed * weights.robberDiscount +
        adjusted * weights.scarcityWeight * (ctx.scarcity[resource] - 1)
    }
  }

  const woodBefore = holdings.pips.wood ?? 0
  const sheepBefore = holdings.pips.sheep ?? 0
  const wheatBefore = holdings.pips.wheat ?? 0
  const brickBefore = holdings.pips.brick ?? 0
  const oreBefore = holdings.pips.ore ?? 0
  const woodAfter = woodBefore + (fast?.adjustedWood ?? adjustedPips(ctx, stats, 'wood'))
  const sheepAfter = sheepBefore + (fast?.adjustedSheep ?? adjustedPips(ctx, stats, 'sheep'))
  const wheatAfter = wheatBefore + (fast?.adjustedWheat ?? adjustedPips(ctx, stats, 'wheat'))
  const brickAfter = brickBefore + (fast?.adjustedBrick ?? adjustedPips(ctx, stats, 'brick'))
  const oreAfter = oreBefore + (fast?.adjustedOre ?? adjustedPips(ctx, stats, 'ore'))
  const diversity = fastDiversityScore(weights, woodAfter, sheepAfter, wheatAfter, brickAfter, oreAfter) -
    fastDiversityScore(weights, woodBefore, sheepBefore, wheatBefore, brickBefore, oreBefore) -
    duplicateNumberPenalty(weights, holdings, stats)
  const port = holdings.ports.length === 0 && stats.ports.length === 0
    ? 0
    : fastPortScore(
        weights,
        holdings.ports,
        stats.ports,
        woodAfter,
        sheepAfter,
        wheatAfter,
        brickAfter,
        oreAfter,
      ) - fastPortScore(
        weights,
        holdings.ports,
        [],
        woodBefore,
        sheepBefore,
        wheatBefore,
        brickBefore,
        oreBefore,
      )
  return base + diversity + port
}

export function scoreCandidate(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
  playerId: string,
  board: Board,
  modifier: PlacementModifier,
): { breakdown: ScoreBreakdown; total: number } {
  const breakdown = modifier(playerId, marginalBreakdown(ctx, holdings, candidate), {
    board,
    vertexId: candidate,
    held: holdings.vertices,
    weights: ctx.weights,
  })
  return { breakdown, total: breakdownTotal(breakdown) }
}
