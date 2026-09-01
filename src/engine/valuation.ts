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
  handValue: number
}

export const breakdownTotal = (breakdown: ScoreBreakdown): number =>
  breakdown.production +
  breakdown.scarcity +
  breakdown.robber +
  breakdown.diversity +
  breakdown.port +
  breakdown.handValue

export type HandCounts = Readonly<Partial<Record<Resource, number>>>

const handValue = (weights: EngineWeights, counts: HandCounts): number => {
  let value = 0
  for (const resource of RESOURCES) {
    value += (counts[resource] ?? 0) * weights.resourceValue[resource]
  }
  return weights.handValueWeight * value
}

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
  /** Cards granted when this vertex is built as a second setup settlement. */
  setupGrant: HandCounts
}

export interface BoardContext {
  stats: ReadonlyMap<VertexId, VertexStats>
  scarcity: Record<Resource, number>
  /** What *missing* each resource costs on this board. See `coverageValues`. */
  coverageValue: Record<Resource, number>
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

/**
 * Per-vertex values that depend only on the board, hoisted out of the scan
 * loop. Resources are spread across named fields rather than a record so the
 * rollout hot path never allocates or does a keyed lookup.
 */
interface VertexPrecompute {
  adjustedBrick: number
  adjustedOre: number
  adjustedSheep: number
  adjustedWheat: number
  adjustedWood: number
  base: number
  setupGrantValue: number
  // The vertex's own best port factor per resource, folded once per board.
  // Combining these across settlements is a plain `Math.max`, because both the
  // dedicated and generic-discounted branches are themselves maxima.
  portFactors: Record<Resource, number>
}

const precomputes = new WeakMap<BoardContext, ReadonlyMap<VertexId, VertexPrecompute>>()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

// Builds the five-resource record as a literal, so the shape stays statically
// checked instead of needing a cast back from Object.fromEntries.
const resourceRecord = (fill: (resource: Resource) => number): Record<Resource, number> => ({
  wood: fill('wood'),
  sheep: fill('sheep'),
  wheat: fill('wheat'),
  brick: fill('brick'),
  ore: fill('ore'),
})

const zeroResources = (): Record<Resource, number> => resourceRecord(() => 0)

/**
 * Roads needed before a settlement `distance` vertices away can trade through
 * a port. Trading needs a settlement on one of the port edge's two endpoints,
 * and those endpoints are adjacent: settling one road out blocks the near one
 * under the distance rule, leaving the far one — still two roads away.
 */
const roadsToPortTrade = (distance: number): number => distance === 1 ? 2 : distance

const adjustedPips = (
  weights: EngineWeights,
  stats: VertexStats,
  resource: Resource,
): number =>
  (stats.pips[resource] ?? 0) - (stats.robbedPips[resource] ?? 0) * weights.robberDiscount

/**
 * Production, board-scarcity and robber value for one vertex, split into the
 * three reported components. `vertexBase` sums them for the scan path, so the
 * arithmetic exists once and the breakdown can never drift from the total.
 */
function baseParts(
  weights: EngineWeights,
  scarcity: Record<Resource, number>,
  stats: VertexStats,
): [production: number, scarcity: number, robber: number] {
  let production = 0
  let scarcityValue = 0
  let robber = 0
  for (const resource of RESOURCES) {
    const raw = stats.pips[resource] ?? 0
    const robbed = stats.robbedPips[resource] ?? 0
    const adjusted = raw - robbed * weights.robberDiscount
    production += raw * weights.resourceValue[resource]
    scarcityValue += adjusted * weights.scarcityWeight * (scarcity[resource] - 1)
    robber -= robbed * weights.robberDiscount
  }
  return [production, scarcityValue, robber]
}

const vertexBase = (
  weights: EngineWeights,
  scarcity: Record<Resource, number>,
  stats: VertexStats,
): number => {
  const [production, scarcityValue, robber] = baseParts(weights, scarcity, stats)
  return production + scarcityValue + robber
}

/**
 * The worth of *covering* each resource, i.e. what it costs to go without it.
 * This is the intrinsic value scaled by board scarcity, because a resource the
 * board is drowning in can be traded for cheaply if you skip it, while a scarce
 * one leaves you with no seller. That makes "which resource do I drop?" depend
 * on the board rather than on a fixed ranking.
 *
 * Distinct from the scarcity component, which prices pips you *own*: that term
 * is zero for a resource you have none of, so it cannot express this at all.
 */
export const coverageValues = (
  weights: EngineWeights,
  scarcity: Record<Resource, number>,
): Record<Resource, number> => resourceRecord((resource) =>
  weights.resourceValue[resource] *
    Math.max(0, 1 + weights.coverageScarcityWeight * (scarcity[resource] - 1)))

export function computeBoardContext(board: Board, weights: EngineWeights): BoardContext {
  const boardPips = zeroResources()
  const hexesByKey = new Map(board.hexes.map((hex) => [axialKey(hex.coord), hex]))
  for (const hex of board.hexes) {
    if (hex.tile === null || hex.tile === 'desert') continue
    boardPips[hex.tile] += pips(hex.numberToken)
  }
  const meanPips = RESOURCES.reduce((sum, resource) => sum + boardPips[resource], 0) / RESOURCES.length
  const scarcity = resourceRecord((resource) =>
    clamp(
      meanPips / Math.max(boardPips[resource], 1),
      weights.scarcityClampMin,
      weights.scarcityClampMax,
    ))

  // Walk the road graph out from each port so nearby vertices bank a decayed
  // share of it. Distance is in road-builds: 0 = on the port edge itself.
  const portsByVertex = new Map<VertexId, PortAccess[]>()
  const adjacency = vertexAdjacency(board.layout)
  // NaN would defeat every `distance >= radius` test and flood the board.
  const radius = Number.isFinite(weights.nearPortRadius)
    ? Math.max(0, weights.nearPortRadius)
    : 0
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
      const decayed = weights.nearPortDecay ** roadsToPortTrade(distance)
      // Distance must never become a bonus, so cap at the on-port value; drop
      // NaN/Infinity before a stray weight poisons every candidate total.
      // (On the port itself this is `decay ** 0`, which is 1 for any decay.)
      const reach = Number.isFinite(decayed) ? clamp(decayed, 0, 1) : 0
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
    const setupGrant = zeroResources()
    const tokenPips: Partial<Record<number, number>> = {}
    for (const key of touching) {
      const hex = hexesByKey.get(key)
      if (!hex || hex.tile === null || hex.tile === 'desert') continue
      const amount = pips(hex.numberToken)
      if (amount <= 0) continue
      setupGrant[hex.tile] += 1
      if (hex.numberToken !== null) {
        tokenPips[hex.numberToken] = (tokenPips[hex.numberToken] ?? 0) + amount
      }
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
      setupGrant,
    })
  }
  const ctx: BoardContext = {
    stats,
    scarcity,
    coverageValue: coverageValues(weights, scarcity),
    weights,
  }
  const cache = new Map<VertexId, VertexPrecompute>()
  for (const [vertexId, vertexStats] of stats) {
    cache.set(vertexId, buildPrecompute(weights, scarcity, vertexStats))
  }
  precomputes.set(ctx, cache)
  return ctx
}

const buildPrecompute = (
  weights: EngineWeights,
  scarcity: Record<Resource, number>,
  stats: VertexStats,
): VertexPrecompute => ({
  adjustedBrick: adjustedPips(weights, stats, 'brick'),
  adjustedOre: adjustedPips(weights, stats, 'ore'),
  adjustedSheep: adjustedPips(weights, stats, 'sheep'),
  adjustedWheat: adjustedPips(weights, stats, 'wheat'),
  adjustedWood: adjustedPips(weights, stats, 'wood'),
  base: vertexBase(weights, scarcity, stats),
  setupGrantValue: handValue(weights, stats.setupGrant),
  portFactors: foldPortFactors(stats.ports, weights.genericPortFactor),
})

// Hand-built contexts (tests, callers that bypass computeBoardContext) have no
// cache, so recompute rather than carrying a second scoring path for them.
const precomputeFor = (
  ctx: BoardContext,
  vertexId: VertexId,
  stats: VertexStats,
): VertexPrecompute =>
  precomputes.get(ctx)?.get(vertexId) ?? buildPrecompute(ctx.weights, ctx.scarcity, stats)

export const emptyHoldings = (): Holdings => ({
  vertices: [],
  pips: {},
  tokenPips: {},
  ports: [],
  portFactors: zeroResources(),
})

export function addToHoldings(ctx: BoardContext, holdings: Holdings, vertexId: VertexId): Holdings {
  const stats = ctx.stats.get(vertexId)
  if (!stats) return holdings
  const nextPips = { ...holdings.pips }
  for (const resource of RESOURCES) {
    const amount = adjustedPips(ctx.weights, stats, resource)
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

function diversityScore(
  ctx: BoardContext,
  wood: number,
  sheep: number,
  wheat: number,
  brick: number,
  ore: number,
): number {
  const weights = ctx.weights
  const cap = weights.diversityCap
  const value = ctx.coverageValue
  // Each resource's coverage is reused by the spread and every recipe it
  // gates, so bind them once: coverage is a fractional Math.pow and this is
  // the innermost loop of every rollout scan.
  const woodCover = coverage(weights, wood, cap)
  const sheepCover = coverage(weights, sheep, cap)
  const wheatCover = coverage(weights, wheat, cap)
  const brickCover = coverage(weights, brick, cap)
  const oreCover = coverage(weights, ore, cap)
  const spread = weights.diversityWeight * (
    value.wood * woodCover +
    value.sheep * sheepCover +
    value.wheat * wheatCover +
    value.brick * brickCover +
    value.ore * oreCover
  )
  const recipeCap = weights.recipeCap
  const sameCap = recipeCap === cap
  const woodRecipe = sameCap ? woodCover : coverage(weights, wood, recipeCap)
  const sheepRecipe = sameCap ? sheepCover : coverage(weights, sheep, recipeCap)
  const wheatRecipe = sameCap ? wheatCover : coverage(weights, wheat, recipeCap)
  const brickRecipe = sameCap ? brickCover : coverage(weights, brick, recipeCap)
  const oreRecipe = sameCap ? oreCover : coverage(weights, ore, recipeCap)
  const road = weights.recipeRoadBonus * Math.min(woodRecipe, brickRecipe)
  const city = weights.recipeCityBonus * Math.min(oreRecipe, wheatRecipe)
  const settlement = weights.recipeSettlementBonus *
    Math.min(woodRecipe, brickRecipe, wheatRecipe, sheepRecipe)
  const devCard = weights.recipeDevCardBonus *
    Math.min(oreRecipe, wheatRecipe, sheepRecipe)
  return spread + road + city + settlement + devCard
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

/**
 * Diversity gained by adding this vertex. Expected payout is linear, but
 * same-number income is fully correlated, lumpier, and vulnerable to one
 * robber-blockable number, hence the duplicate-token penalty.
 */
function diversityDelta(
  ctx: BoardContext,
  holdings: Holdings,
  stats: VertexStats,
  precompute: VertexPrecompute,
): number {
  const wood = holdings.pips.wood ?? 0
  const sheep = holdings.pips.sheep ?? 0
  const wheat = holdings.pips.wheat ?? 0
  const brick = holdings.pips.brick ?? 0
  const ore = holdings.pips.ore ?? 0
  return diversityScore(
    ctx,
    wood + precompute.adjustedWood,
    sheep + precompute.adjustedSheep,
    wheat + precompute.adjustedWheat,
    brick + precompute.adjustedBrick,
    ore + precompute.adjustedOre,
  ) -
    diversityScore(ctx, wood, sheep, wheat, brick, ore) -
    duplicateNumberPenalty(ctx.weights, holdings, stats)
}

const portFactor = (rate: number): number =>
  Math.max(0, 1 / rate - 1 / 4) / (1 / 2 - 1 / 4)

/** Best access per resource in one pass; a generic port hedges at a discount. */
function foldPortFactors(
  accesses: readonly PortAccess[],
  genericPortFactor: number,
): Record<Resource, number> {
  const factors = zeroResources()
  let generic = 0
  // Best access wins rather than accumulating, so holding two corners of the
  // same port (or a closer road to it) never double-counts.
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

// What a port converts surplus *into*. `total` is the summed recipe-cap
// coverage of all five resources and `own` the ported resource's own share, so
// the fraction below is the mean coverage of the other four: 0 when they are
// untouched, 1 when all four are saturated. At weight 0 the factor is exactly
// 1 and every product it multiplies is bit-for-bit unchanged.
const portDeficitFactor = (weights: EngineWeights, total: number, own: number): number =>
  1 + weights.portCoverageDeficitWeight * (1 - (total - own) / 4)

/**
 * Port value gained by adding this vertex. The candidate's folded factors
 * combine with the holding's by `Math.max` — each is already a maximum over
 * its own accesses, so no access list is walked per scan. Surplus uses full
 * production; the conservative `portWeight` stands in for consumption.
 */
function portDelta(
  ctx: BoardContext,
  holdings: Holdings,
  stats: VertexStats,
  precompute: VertexPrecompute,
): number {
  if (holdings.ports.length === 0 && stats.ports.length === 0) return 0
  const weights = ctx.weights
  const held = holdings.portFactors
  const gained = precompute.portFactors
  const wood = holdings.pips.wood ?? 0
  const sheep = holdings.pips.sheep ?? 0
  const wheat = holdings.pips.wheat ?? 0
  const brick = holdings.pips.brick ?? 0
  const ore = holdings.pips.ore ?? 0
  // Each half of each difference carries its own state's deficit, so the term
  // stays a true delta rather than repricing the holding's existing ports at
  // the post-move spread. Left at 1 unless the weight asks for the ten
  // fractional `coverage` powers below, which sit in every rollout scan.
  let woodPre = 1
  let sheepPre = 1
  let wheatPre = 1
  let brickPre = 1
  let orePre = 1
  let woodPost = 1
  let sheepPost = 1
  let wheatPost = 1
  let brickPost = 1
  let orePost = 1
  if (weights.portCoverageDeficitWeight !== 0) {
    const cap = weights.recipeCap
    const woodCover = coverage(weights, wood, cap)
    const sheepCover = coverage(weights, sheep, cap)
    const wheatCover = coverage(weights, wheat, cap)
    const brickCover = coverage(weights, brick, cap)
    const oreCover = coverage(weights, ore, cap)
    const total = woodCover + sheepCover + wheatCover + brickCover + oreCover
    woodPre = portDeficitFactor(weights, total, woodCover)
    sheepPre = portDeficitFactor(weights, total, sheepCover)
    wheatPre = portDeficitFactor(weights, total, wheatCover)
    brickPre = portDeficitFactor(weights, total, brickCover)
    orePre = portDeficitFactor(weights, total, oreCover)
    const woodNext = coverage(weights, wood + precompute.adjustedWood, cap)
    const sheepNext = coverage(weights, sheep + precompute.adjustedSheep, cap)
    const wheatNext = coverage(weights, wheat + precompute.adjustedWheat, cap)
    const brickNext = coverage(weights, brick + precompute.adjustedBrick, cap)
    const oreNext = coverage(weights, ore + precompute.adjustedOre, cap)
    const nextTotal = woodNext + sheepNext + wheatNext + brickNext + oreNext
    woodPost = portDeficitFactor(weights, nextTotal, woodNext)
    sheepPost = portDeficitFactor(weights, nextTotal, sheepNext)
    wheatPost = portDeficitFactor(weights, nextTotal, wheatNext)
    brickPost = portDeficitFactor(weights, nextTotal, brickNext)
    orePost = portDeficitFactor(weights, nextTotal, oreNext)
  }
  return weights.portWeight * (
    portSurplus(weights, wood + precompute.adjustedWood) * Math.max(held.wood, gained.wood) * woodPost -
      portSurplus(weights, wood) * held.wood * woodPre +
    portSurplus(weights, sheep + precompute.adjustedSheep) * Math.max(held.sheep, gained.sheep) * sheepPost -
      portSurplus(weights, sheep) * held.sheep * sheepPre +
    portSurplus(weights, wheat + precompute.adjustedWheat) * Math.max(held.wheat, gained.wheat) * wheatPost -
      portSurplus(weights, wheat) * held.wheat * wheatPre +
    portSurplus(weights, brick + precompute.adjustedBrick) * Math.max(held.brick, gained.brick) * brickPost -
      portSurplus(weights, brick) * held.brick * brickPre +
    portSurplus(weights, ore + precompute.adjustedOre) * Math.max(held.ore, gained.ore) * orePost -
      portSurplus(weights, ore) * held.ore * orePre
  )
}

export function marginalBreakdown(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
  hand: HandCounts | null = null,
): ScoreBreakdown {
  const stats = ctx.stats.get(candidate)
  if (!stats) {
    return { production: 0, scarcity: 0, robber: 0, diversity: 0, port: 0, handValue: 0 }
  }
  const precompute = precomputeFor(ctx, candidate, stats)
  const [production, scarcity, robber] = baseParts(ctx.weights, ctx.scarcity, stats)
  return {
    production,
    scarcity,
    robber,
    diversity: diversityDelta(ctx, holdings, stats, precompute),
    port: portDelta(ctx, holdings, stats, precompute),
    handValue: hand === null ? 0 : handValue(ctx.weights, hand),
  }
}

/**
 * The same score as `marginalBreakdown`, without allocating the breakdown or
 * running a modifier, the form rollout scans call millions of times. It shares
 * every term with the breakdown, including pricing the same hand counts, so
 * the two cannot disagree.
 */
export function marginalTotal(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
  hand: HandCounts | null = null,
): number {
  const stats = ctx.stats.get(candidate)
  if (!stats) return 0
  const precompute = precomputeFor(ctx, candidate, stats)
  return precompute.base +
    diversityDelta(ctx, holdings, stats, precompute) +
    portDelta(ctx, holdings, stats, precompute) +
    (hand === null
      ? 0
      // Setup callers pass this exact precomputed vector. Its scalar was built
      // under the same weights, avoiding five resource lookups per rollout scan.
      : hand === stats.setupGrant
        ? precompute.setupGrantValue
        : handValue(ctx.weights, hand))
}

export function scoreCandidate(
  ctx: BoardContext,
  holdings: Holdings,
  candidate: VertexId,
  playerId: string,
  board: Board,
  modifier: PlacementModifier,
  hand: HandCounts | null = null,
): { breakdown: ScoreBreakdown; total: number } {
  const breakdown = modifier(playerId, marginalBreakdown(ctx, holdings, candidate, hand), {
    board,
    vertexId: candidate,
    held: holdings.vertices,
    weights: ctx.weights,
  })
  return { breakdown, total: breakdownTotal(breakdown) }
}
