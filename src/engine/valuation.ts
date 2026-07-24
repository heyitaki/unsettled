import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import { pips, vertexProduction } from '../model/board'
import { boardGrid } from '../model/layouts'
import { RESOURCES, type Board, type Port, type Resource, type VertexId } from '../model/types'
import { vertexAdjacency } from './legality'
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

/**
 * A port this vertex can trade through, and how much of its value is really
 * available. `reach` is 1 when the settlement sits on the port edge and decays
 * per road-build needed to reach it, so a strong inland spot near a matching
 * port keeps its production *and* banks most of the port.
 */
export interface PortAccess {
  port: Port
  reach: number
}

export interface VertexStats {
  pips: Partial<Record<Resource, number>>
  robbedPips: Partial<Record<Resource, number>>
  tokenPips: Partial<Record<number, number>>
  ports: PortAccess[]
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
  ports: PortAccess[]
  /** Derived from `ports` at the single write point, for hot-path lookups. */
  portFactors: Record<Resource, number>
}

interface FastVertexStats {
  adjustedBrick: number
  adjustedOre: number
  adjustedSheep: number
  adjustedWheat: number
  adjustedWood: number
  base: number
  // The vertex's own best port factor per resource, folded once per board.
  // Combining these across settlements is a plain `Math.max`, because both the
  // dedicated and generic-discounted branches are themselves maxima.
  portFactors: Record<Resource, number>
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

  // Walk the road graph out from each port so nearby vertices bank a decayed
  // share of it. Distance is in road-builds: 0 = on the port edge itself.
  const portsByVertex = new Map<VertexId, PortAccess[]>()
  const adjacency = vertexAdjacency(board.layout)
  const radius = Math.max(0, weights.nearPortRadius)
  for (const port of board.ports) {
    const distances = new Map<VertexId, number>()
    const queue: VertexId[] = []
    for (const vertexId of edgeEndpointVertexIds(port.edgeId)) {
      if (distances.has(vertexId)) continue
      distances.set(vertexId, 0)
      queue.push(vertexId)
    }
    for (let head = 0; head < queue.length; head += 1) {
      const vertexId = queue[head]
      const distance = distances.get(vertexId) ?? 0
      if (distance >= radius) continue
      for (const neighbor of adjacency.get(vertexId) ?? []) {
        if (distances.has(neighbor)) continue
        distances.set(neighbor, distance + 1)
        queue.push(neighbor)
      }
    }
    for (const [vertexId, distance] of distances) {
      const reach = distance === 0 ? 1 : weights.nearPortDecay ** distance
      if (reach <= 0) continue
      const accesses = portsByVertex.get(vertexId)
      if (accesses) accesses.push({ port, reach })
      else portsByVertex.set(vertexId, [{ port, reach }])
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
      base += raw * weights.resourceValue[resource] -
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
      portFactors: foldPortFactors(vertexStats.ports, weights.genericPortFactor),
    })
  }
  fastContexts.set(ctx, fastStats)
  return ctx
}

export const emptyHoldings = (): Holdings => ({
  vertices: [],
  pips: {},
  tokenPips: {},
  ports: [],
  portFactors: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 },
})

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
  // One entry per port edge, keeping the closest access: a second settlement
  // nearer the same port upgrades its reach instead of stacking with it.
  const ports = [...holdings.ports]
  for (const access of stats.ports) {
    const index = ports.findIndex((held) => held.port.edgeId === access.port.edgeId)
    if (index === -1) ports.push(access)
    else if (access.reach > ports[index].reach) ports[index] = access
  }
  return {
    vertices: [...holdings.vertices, vertexId],
    pips: nextPips,
    tokenPips,
    ports,
    portFactors: foldPortFactors(ports, ctx.weights.genericPortFactor),
  }
}

// Fraction of "real coverage" a resource earns at `pips`, gated so a lone
// low-probability token (2/12 = 1 pip) counts for far less than its linear
// share. Full credit at `cap` pips; sub-linear below via coverageExponent.
// The base is clamped to 0 because a fractional exponent turns any negative
// base into NaN, which would silently void every candidate's total.
const coverage = (weights: EngineWeights, pips: number, cap: number): number =>
  Math.max(0, Math.min(pips, cap) / cap) ** weights.coverageExponent

const diversityScore = (
  weights: EngineWeights,
  pipsFor: (resource: Resource) => number,
): number => {
  let score = 0
  for (const resource of RESOURCES) {
    score += weights.diversityWeight * weights.resourceValue[resource] *
      coverage(weights, pipsFor(resource), weights.diversityCap)
  }
  const recipe = (resources: readonly Resource[], bonus: number): number =>
    bonus * Math.min(...resources.map((resource) =>
      coverage(weights, pipsFor(resource), weights.recipeCap)))
  return score +
    recipe(['wood', 'brick'], weights.recipeRoadBonus) +
    recipe(['ore', 'wheat'], weights.recipeCityBonus) +
    recipe(['wood', 'brick', 'wheat', 'sheep'], weights.recipeSettlementBonus)
}

const portFactor = (rate: number): number =>
  Math.max(0, 1 / rate - 1 / 4) / (1 / 2 - 1 / 4)

function effectivePortFactor(
  ports: readonly PortAccess[],
  resource: Resource,
  genericPortFactor: number,
  extraPorts: readonly PortAccess[] = [],
): number {
  let dedicated = 0
  let generic = 0
  // Best access wins rather than accumulating, so holding two corners of the
  // same port (or a closer road to it) never double-counts.
  const consider = ({ port, reach }: PortAccess): void => {
    const factor = portFactor(port.rate) * reach
    if (port.resource === resource) dedicated = Math.max(dedicated, factor)
    else if (port.resource === null) generic = Math.max(generic, factor)
  }
  for (const access of ports) consider(access)
  for (const access of extraPorts) consider(access)
  return Math.max(dedicated, genericPortFactor * generic)
}

/** All five factors in one pass, for the per-board precompute. */
function foldPortFactors(
  accesses: readonly PortAccess[],
  genericPortFactor: number,
): Record<Resource, number> {
  const factors: Record<Resource, number> = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
  let generic = 0
  for (const { port, reach } of accesses) {
    const factor = portFactor(port.rate) * reach
    if (port.resource === null) generic = Math.max(generic, factor)
    else factors[port.resource] = Math.max(factors[port.resource], factor)
  }
  const discounted = genericPortFactor * generic
  for (const resource of RESOURCES) {
    factors[resource] = Math.max(factors[resource], discounted)
  }
  return factors
}

// A port monetizes only production *above* the surplus threshold: below it,
// you consume everything you make and have nothing to trade away.
const portSurplus = (weights: EngineWeights, pips: number): number =>
  Math.max(0, pips - weights.portSurplusThreshold)

function portScore(
  weights: EngineWeights,
  pipsFor: (resource: Resource) => number,
  ports: readonly PortAccess[],
  extraPorts: readonly PortAccess[] = [],
): number {
  let score = 0
  for (const resource of RESOURCES) {
    score += portSurplus(weights, pipsFor(resource)) *
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
  const cap = weights.diversityCap
  const rv = weights.resourceValue
  const spread = weights.diversityWeight * (
    rv.wood * coverage(weights, wood, cap) +
    rv.sheep * coverage(weights, sheep, cap) +
    rv.wheat * coverage(weights, wheat, cap) +
    rv.brick * coverage(weights, brick, cap) +
    rv.ore * coverage(weights, ore, cap)
  )
  const recipeCap = weights.recipeCap
  const road = weights.recipeRoadBonus *
    Math.min(coverage(weights, wood, recipeCap), coverage(weights, brick, recipeCap))
  const city = weights.recipeCityBonus *
    Math.min(coverage(weights, ore, recipeCap), coverage(weights, wheat, recipeCap))
  const settlement = weights.recipeSettlementBonus * Math.min(
    coverage(weights, wood, recipeCap),
    coverage(weights, brick, recipeCap),
    coverage(weights, wheat, recipeCap),
    coverage(weights, sheep, recipeCap),
  )
  return spread + road + city + settlement
}

/**
 * Marginal port value from precomputed factors: the candidate's own factors
 * fold into the holding's by `Math.max`, so no access list is walked per scan.
 */
function fastPortDelta(
  weights: EngineWeights,
  held: Record<Resource, number>,
  gained: Record<Resource, number>,
  woodBefore: number,
  sheepBefore: number,
  wheatBefore: number,
  brickBefore: number,
  oreBefore: number,
  woodAfter: number,
  sheepAfter: number,
  wheatAfter: number,
  brickAfter: number,
  oreAfter: number,
): number {
  return weights.portWeight * (
    portSurplus(weights, woodAfter) * Math.max(held.wood, gained.wood) -
      portSurplus(weights, woodBefore) * held.wood +
    portSurplus(weights, sheepAfter) * Math.max(held.sheep, gained.sheep) -
      portSurplus(weights, sheepBefore) * held.sheep +
    portSurplus(weights, wheatAfter) * Math.max(held.wheat, gained.wheat) -
      portSurplus(weights, wheatBefore) * held.wheat +
    portSurplus(weights, brickAfter) * Math.max(held.brick, gained.brick) -
      portSurplus(weights, brickBefore) * held.brick +
    portSurplus(weights, oreAfter) * Math.max(held.ore, gained.ore) -
      portSurplus(weights, oreBefore) * held.ore
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
    production += raw * ctx.weights.resourceValue[resource]
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
      base += raw * weights.resourceValue[resource] -
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
    : fastPortDelta(
        weights,
        holdings.portFactors,
        fast?.portFactors ?? foldPortFactors(stats.ports, weights.genericPortFactor),
        woodBefore,
        sheepBefore,
        wheatBefore,
        brickBefore,
        oreBefore,
        woodAfter,
        sheepAfter,
        wheatAfter,
        brickAfter,
        oreAfter,
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
