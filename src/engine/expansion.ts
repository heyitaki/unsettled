import { edgeEndpointVertexIds, vertexIncidentEdgeIds } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { EdgeId, LayoutId, VertexId } from '../model/types'
import { vertexAdjacency } from './legality'
import {
  addToHoldings,
  marginalWithoutExpansion,
  type BoardContext,
  type Holdings,
  type Occupancy,
} from './valuation'

/** Paid road-builds a site may cost before it is out of reach. The free setup road is not one. */
const MAX_PAID_BUILDS = 2

/** A site the candidate opens, at the cheapest cost it can be reached for. */
export interface ExpansionSite {
  vertexId: VertexId
  /** Roads that must be bought to settle it, over and above the free setup road. */
  paidBuilds: number
  /** The candidate's own incident edge the cheapest path leaves through. */
  firstEdge: EdgeId
}

/** One step out of a vertex: the edge taken and the vertex it lands on. */
interface Step {
  edgeId: EdgeId
  to: VertexId
}

/**
 * The layout's road graph in the one shape the walk wants: every vertex's grid-filtered steps,
 * each already carrying its edge. Built once per layout, because `vertexIncidentEdgeIds` and
 * `edgeEndpointVertexIds` both parse and rebuild coordinate strings on every call.
 */
const graphs = new Map<LayoutId, ReadonlyMap<VertexId, readonly Step[]>>()

function roadGraph(layout: LayoutId): ReadonlyMap<VertexId, readonly Step[]> {
  const cached = graphs.get(layout)
  if (cached) return cached
  const grid = boardGrid(layout)
  const inGrid = new Set(grid.vertexIds)
  const edges = new Set(grid.edgeIds)
  const graph = new Map<VertexId, readonly Step[]>()
  for (const vertexId of grid.vertexIds) {
    const steps: Step[] = []
    for (const edgeId of vertexIncidentEdgeIds(vertexId)) {
      if (!edges.has(edgeId)) continue
      const to = edgeEndpointVertexIds(edgeId).find((endpoint) => endpoint !== vertexId)
      if (to === undefined || !inGrid.has(to)) continue
      steps.push({ edgeId, to })
    }
    graph.set(vertexId, steps)
  }
  graphs.set(layout, graph)
  return graph
}

/** One walk state: a vertex, and whether the free setup road has been spent getting there. */
interface Reached {
  vertexId: VertexId
  roadUsed: boolean
}

const stateKey = (vertexId: VertexId, roadUsed: boolean): string =>
  roadUsed ? `1${vertexId}` : `0${vertexId}`

/**
 * Every site the candidate opens through one of its own incident edges, keyed by that edge.
 *
 * The walk leaves `candidate` along `firstEdge` and spreads outward. A rival's road is
 * impassable and a vertex a rival holds is a dead end, because a settlement stops a road network
 * even though a road may be laid right up to it. The seat's own roads are free to travel, the
 * first unowned edge on a path is free as well (it is the setup road the settlement comes with),
 * and every unowned edge after that costs one paid build. Reach ends at `MAX_PAID_BUILDS`.
 *
 * `own` is the seat's own occupied vertices, which `Occupancy` cannot tell from a rival's on its
 * own; `occupancy.seat` names the seat whose roads are free. A site is a vertex at least two
 * edges out that would be legal once the candidate is built: unoccupied, with no occupied
 * neighbour, and not adjacent to the candidate.
 */
export function expansionSitesByEdge(
  layout: LayoutId,
  occupancy: Occupancy,
  own: ReadonlySet<VertexId>,
  candidate: VertexId,
): Map<EdgeId, ExpansionSite[]> {
  const byEdge = new Map<EdgeId, ExpansionSite[]>()
  const graph = roadGraph(layout)
  const start = graph.get(candidate)
  if (start === undefined) return byEdge
  const adjacency = vertexAdjacency(layout)
  const neighbours = new Set(adjacency.get(candidate) ?? [])
  const rival = (vertexId: VertexId): boolean =>
    occupancy.blocked.has(vertexId) && !own.has(vertexId)
  const isSite = (vertexId: VertexId): boolean =>
    !occupancy.blocked.has(vertexId) &&
    !own.has(vertexId) &&
    !neighbours.has(vertexId) &&
    (adjacency.get(vertexId) ?? []).every((neighbour) => !occupancy.blocked.has(neighbour))

  for (const first of start) {
    const firstOwner = occupancy.edgeOwner.get(first.edgeId)
    if (firstOwner !== undefined && firstOwner !== occupancy.seat) continue
    // Cheapest-first: a free step joins the band being drained, a paid one the next band, so a
    // state is settled at its minimum paid-build count the first time it is popped.
    const bands: Reached[][] = [[], [], []]
    // The free setup road is spent only on an edge nobody owns; travelling the seat's own road
    // keeps it in hand for later on the same path.
    bands[0].push({ vertexId: first.to, roadUsed: firstOwner === undefined })
    const settled = new Set<string>()
    const sites: ExpansionSite[] = []
    for (let cost = 0; cost <= MAX_PAID_BUILDS; cost += 1) {
      const band = bands[cost]
      for (let head = 0; head < band.length; head += 1) {
        const state = band[head]
        const key = stateKey(state.vertexId, state.roadUsed)
        if (settled.has(key)) continue
        settled.add(key)
        // Every vertex past the first step is at least two edges out; the adjacency test in
        // `isSite` drops the ones that are two edges out but still touch the candidate.
        if (state.vertexId !== first.to && isSite(state.vertexId)) {
          sites.push({ vertexId: state.vertexId, paidBuilds: cost, firstEdge: first.edgeId })
        }
        if (rival(state.vertexId)) continue
        for (const step of graph.get(state.vertexId) ?? []) {
          const owner = occupancy.edgeOwner.get(step.edgeId)
          if (owner !== undefined && owner !== occupancy.seat) continue
          const unowned = owner === undefined
          const nextCost = cost + (unowned && state.roadUsed ? 1 : 0)
          if (nextCost > MAX_PAID_BUILDS) continue
          const roadUsed = state.roadUsed || unowned
          if (settled.has(stateKey(step.to, roadUsed))) continue
          bands[nextCost].push({ vertexId: step.to, roadUsed })
        }
      }
    }
    if (sites.length > 0) byEdge.set(first.edgeId, sites)
  }
  return byEdge
}

/**
 * The sites the candidate opens, each at its cheapest paid-build count over every first edge, in
 * ascending vertex order. See `expansionSitesByEdge` for the walk itself.
 */
export function expansionSites(
  layout: LayoutId,
  occupancy: Occupancy,
  own: ReadonlySet<VertexId>,
  candidate: VertexId,
): ExpansionSite[] {
  const cheapest = new Map<VertexId, ExpansionSite>()
  for (const sites of expansionSitesByEdge(layout, occupancy, own, candidate).values()) {
    for (const site of sites) {
      const held = cheapest.get(site.vertexId)
      // Ties on cost go to the lower edge id, so the answer never depends on walk order.
      if (
        held === undefined ||
        site.paidBuilds < held.paidBuilds ||
        (site.paidBuilds === held.paidBuilds && site.firstEdge < held.firstEdge)
      ) {
        cheapest.set(site.vertexId, site)
      }
    }
  }
  return [...cheapest.values()].sort((left, right) =>
    left.vertexId < right.vertexId ? -1 : left.vertexId > right.vertexId ? 1 : 0)
}

export interface ExpansionValue {
  /** The term, already multiplied by `expansionWeight`. */
  value: number
  /** The setup road to lay, or null when the candidate opens nothing. */
  road: EdgeId | null
}

const NO_EXPANSION: ExpansionValue = { value: 0, road: null }

/** Sum of the two largest values, or of the one there is, or 0 for none. */
function topTwo(values: readonly number[]): number {
  let first = -Infinity
  let second = -Infinity
  for (const value of values) {
    if (value > first) {
      second = first
      first = value
    } else if (value > second) {
      second = value
    }
  }
  if (first === -Infinity) return 0
  return second === -Infinity ? first : first + second
}

/**
 * What the candidate is worth as a place to expand *from*, and the road that goes there.
 *
 * A site is priced by what settling it would be worth to this pair: the ordinary formula's
 * marginal score of the site given the holdings plus the candidate, with no setup grant and with
 * the expansion component itself left out, so the term cannot recurse. That value decays by one
 * factor of `expansionDecay` per paid road-build, and the term is the weight times the sum of the
 * two best sites, because a pair only ever settles a handful of them.
 *
 * The road is the first edge of the cheapest path to the best site, ties broken by the larger
 * top-two sum still reachable through that edge, then by the lower edge id.
 */
export function expansionTerm(
  ctx: BoardContext,
  holdings: Holdings,
  occupancy: Occupancy,
  candidate: VertexId,
): ExpansionValue {
  const weights = ctx.weights
  if (weights.expansionWeight === 0) return NO_EXPANSION
  // Matches `marginalBreakdown`'s early return, so the breakdown and the total cannot disagree
  // about a vertex the board has no stats for.
  if (!ctx.stats.has(candidate)) return NO_EXPANSION
  const own = new Set<VertexId>(holdings.vertices)
  own.add(candidate)
  const byEdge = expansionSitesByEdge(ctx.layout, occupancy, own, candidate)
  if (byEdge.size === 0) return NO_EXPANSION
  const withCandidate = addToHoldings(ctx, holdings, candidate)
  // One score per site, shared by every first edge that reaches it: a site's worth depends on
  // the site and the pair, never on the road taken to get there.
  const scores = new Map<VertexId, number>()
  const discounted = (site: ExpansionSite): number => {
    let score = scores.get(site.vertexId)
    if (score === undefined) {
      // No draft slot: a site is a settlement some later turn buys, so what the pair's *current*
      // pick position leans on says nothing about it. SP4's scales price this whole term instead,
      // through the `expansion` scale its caller applies. `placement/expansion.rs::term` matches.
      score = marginalWithoutExpansion(ctx, withCandidate, site.vertexId)
      scores.set(site.vertexId, score)
    }
    return score * weights.expansionDecay ** site.paidBuilds
  }

  let road: EdgeId | null = null
  let bestSite = -Infinity
  let bestPair = -Infinity
  const cheapest = new Map<VertexId, number>()
  for (const [firstEdge, sites] of byEdge) {
    const values = sites.map(discounted)
    const best = Math.max(...values)
    const pair = topTwo(values)
    if (
      road === null ||
      best > bestSite ||
      (best === bestSite && pair > bestPair) ||
      (best === bestSite && pair === bestPair && firstEdge < road)
    ) {
      road = firstEdge
      bestSite = best
      bestPair = pair
    }
    for (let index = 0; index < sites.length; index += 1) {
      const held = cheapest.get(sites[index].vertexId)
      // The cheapest path is the most valuable one, decay being at most 1 per build.
      if (held === undefined || values[index] > held) {
        cheapest.set(sites[index].vertexId, values[index])
      }
    }
  }
  return { value: weights.expansionWeight * topTwo([...cheapest.values()]), road }
}
