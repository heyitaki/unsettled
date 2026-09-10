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

/** One step out of a vertex: the edge taken, and the index of the vertex it lands on. */
interface Step {
  edgeId: EdgeId
  to: number
}

/**
 * The layout's road graph in the one shape the walk wants: every vertex's grid-filtered steps and
 * grid-filtered neighbours, both keyed by a dense vertex index rather than by `VertexId`.
 *
 * Built once per layout. The index is what keeps the walk off strings: a `VertexId` is an
 * eighteen-character coordinate triple, so a `Set`/`Map` keyed by one hashes that string on every
 * probe, and the walk probes on the order of a hundred times per candidate. `analyzeBoard` runs
 * the walk hundreds of thousands of times on a six-player board, which is enough for that hashing
 * alone to dominate the whole analysis.
 */
interface RoadGraph {
  vertexIds: readonly VertexId[]
  indexOf: ReadonlyMap<VertexId, number>
  /** Steps out of each vertex, in `vertexIncidentEdgeIds` order, which fixes the walk's order. */
  steps: readonly (readonly Step[])[]
  /** Each vertex's grid neighbours as indices, in `vertexAdjacency` order. */
  neighbours: readonly (readonly number[])[]
}

const graphs = new Map<LayoutId, RoadGraph>()

function roadGraph(layout: LayoutId): RoadGraph {
  const cached = graphs.get(layout)
  if (cached) return cached
  const grid = boardGrid(layout)
  const adjacency = vertexAdjacency(layout)
  const edges = new Set(grid.edgeIds)
  const vertexIds = grid.vertexIds
  const indexOf = new Map<VertexId, number>()
  vertexIds.forEach((vertexId, index) => indexOf.set(vertexId, index))
  const steps: Step[][] = []
  const neighbours: number[][] = []
  for (const vertexId of vertexIds) {
    const out: Step[] = []
    for (const edgeId of vertexIncidentEdgeIds(vertexId)) {
      if (!edges.has(edgeId)) continue
      const to = edgeEndpointVertexIds(edgeId).find((endpoint) => endpoint !== vertexId)
      const toIndex = to === undefined ? undefined : indexOf.get(to)
      if (toIndex === undefined) continue
      out.push({ edgeId, to: toIndex })
    }
    steps.push(out)
    neighbours.push((adjacency.get(vertexId) ?? []).map((neighbour) => indexOf.get(neighbour)!))
  }
  const graph: RoadGraph = { vertexIds, indexOf, steps, neighbours }
  graphs.set(layout, graph)
  return graph
}

/**
 * The walk's reusable working memory for one layout: stamp arrays instead of sets, so nothing is
 * allocated or cleared per call. A slot belongs to the current walk only while its stamp matches
 * the live counter, which is bumped rather than reset. `Float64Array` because the counters run
 * into the millions over a session and an exact integer up to 2^53 cannot wrap.
 */
interface Scratch {
  /** Per call: `blocked` and `own` membership, bit 0 and bit 1, for a vertex the walk asked about. */
  flagStamp: Float64Array
  flags: Uint8Array
  /** Per call: whether a vertex is a site the candidate could later settle. */
  siteStamp: Float64Array
  site: Uint8Array
  /** Per first edge: states already popped, and vertices already listed as sites. */
  settled: Float64Array
  recorded: Float64Array
  /** One queue per paid-build count, drained cheapest first. Reused, never reallocated. */
  bands: [number[], number[], number[]]
  /** The walk's output, flat: see `WalkOutput`. */
  output: WalkOutput
  /** Per `expansionTerm` call: a site's undiscounted score, and its cheapest reach so far. */
  scoreStamp: Float64Array
  score: Float64Array
  cheapStamp: Float64Array
  cheapPaid: Int32Array
  cheapValue: Float64Array
  touched: number[]
  call: number
  walk: number
  term: number
}

/**
 * The walk's sites, grouped by the first edge that reaches them, without an object per site.
 * `edgeIds[e]` owns the span `[edgeStart[e], edgeEnd[e])` of the flat site arrays.
 *
 * Valid only until the next walk on the same layout. Read it before walking again.
 */
interface WalkOutput {
  edgeIds: EdgeId[]
  edgeStart: number[]
  edgeEnd: number[]
  /** Site vertex indices and their paid-build counts, grouped by edge in `edgeIds` order. */
  siteVertex: number[]
  sitePaid: number[]
}

const scratches = new Map<LayoutId, Scratch>()

function scratchFor(layout: LayoutId, size: number): Scratch {
  const cached = scratches.get(layout)
  if (cached) return cached
  const scratch: Scratch = {
    flagStamp: new Float64Array(size),
    flags: new Uint8Array(size),
    siteStamp: new Float64Array(size),
    site: new Uint8Array(size),
    // Two lanes per vertex, one per `roadUsed` value; see `packState`.
    settled: new Float64Array(size * 2),
    recorded: new Float64Array(size),
    bands: [[], [], []],
    output: { edgeIds: [], edgeStart: [], edgeEnd: [], siteVertex: [], sitePaid: [] },
    scoreStamp: new Float64Array(size),
    score: new Float64Array(size),
    cheapStamp: new Float64Array(size),
    cheapPaid: new Int32Array(size),
    cheapValue: new Float64Array(size),
    touched: [],
    call: 0,
    walk: 0,
    term: 0,
  }
  scratches.set(layout, scratch)
  return scratch
}

/** A walk state, packed into one integer: the vertex index and whether the setup road is spent. */
const packState = (vertexIndex: number, roadUsed: boolean): number =>
  roadUsed ? vertexIndex * 2 + 1 : vertexIndex * 2

/**
 * The walk itself, writing its sites into `layout`'s reusable scratch rather than returning them.
 *
 * The walk leaves `candidate` along each of its own incident edges in turn and spreads outward. A
 * rival's road is impassable and a vertex a rival holds is a dead end, because a settlement stops
 * a road network even though a road may be laid right up to it. The seat's own roads are free to
 * travel, the first unowned edge on a path is free as well (it is the setup road the settlement
 * comes with), and every unowned edge after that costs one paid build. Reach ends at
 * `MAX_PAID_BUILDS`.
 *
 * `own` is the seat's own occupied vertices, which `Occupancy` cannot tell from a rival's on its
 * own; `occupancy.seat` names the seat whose roads are free.
 *
 * Returns null when the candidate is off the grid, which is the one case with no scratch to read.
 */
export function walkSites(
  layout: LayoutId,
  occupancy: Occupancy,
  own: ReadonlySet<VertexId>,
  candidate: VertexId,
): Scratch | null {
  const graph = roadGraph(layout)
  const from = graph.indexOf.get(candidate)
  if (from === undefined) return null
  const { vertexIds, steps, neighbours } = graph
  const { blocked, edgeOwner, seat } = occupancy
  const scratch = scratchFor(layout, vertexIds.length)
  scratch.call += 1
  const call = scratch.call
  const candidateNeighbours = neighbours[from]
  const out = scratch.output
  out.edgeIds.length = 0
  out.edgeStart.length = 0
  out.edgeEnd.length = 0
  out.siteVertex.length = 0
  out.sitePaid.length = 0

  // `blocked` and `own` are asked about the same vertex once per first edge the walk leaves
  // through and once per neighbour of every state it pops, so the answer is memoized for the call.
  const flagsAt = (index: number): number => {
    if (scratch.flagStamp[index] !== call) {
      scratch.flagStamp[index] = call
      const vertexId = vertexIds[index]
      scratch.flags[index] = (blocked.has(vertexId) ? 1 : 0) | (own.has(vertexId) ? 2 : 0)
    }
    return scratch.flags[index]
  }
  // Occupied means blocked or the seat's own, on the vertex and on each of its neighbours alike.
  // `Occupancy.blocked` covers a rival's buildings and `own` the seat's, and the neighbour test
  // has to read both: `placement/expansion.rs` reads one owner array that already holds each.
  const occupied = (index: number): boolean => flagsAt(index) !== 0
  const rival = (index: number): boolean => flagsAt(index) === 1
  // A site is a vertex at least two edges out that would be legal once the candidate is built:
  // unoccupied, with no occupied neighbour, and not adjacent to the candidate.
  const isSite = (index: number): boolean => {
    if (scratch.siteStamp[index] !== call) {
      scratch.siteStamp[index] = call
      // Plain loops, not `includes`/`every` with a predicate: this runs a few dozen times per
      // walk and a walk runs hundreds of thousands of times per analysis, so a closure per call
      // is a closure per site test.
      let site = !occupied(index)
      const around = neighbours[index]
      for (let at = 0; site && at < candidateNeighbours.length; at += 1) {
        if (candidateNeighbours[at] === index) site = false
      }
      for (let at = 0; site && at < around.length; at += 1) {
        if (occupied(around[at])) site = false
      }
      scratch.site[index] = site ? 1 : 0
    }
    return scratch.site[index] === 1
  }

  for (const first of steps[from]) {
    const firstOwner = edgeOwner.get(first.edgeId)
    if (firstOwner !== undefined && firstOwner !== seat) continue
    scratch.walk += 1
    const walk = scratch.walk
    // Cheapest-first: a free step joins the band being drained, a paid one the next band, so a
    // state is settled at its minimum paid-build count the first time it is popped.
    const bands = scratch.bands
    bands[0].length = 0
    bands[1].length = 0
    bands[2].length = 0
    // The free setup road is spent only on an edge nobody owns; travelling the seat's own road
    // keeps it in hand for later on the same path.
    bands[0].push(packState(first.to, firstOwner === undefined))
    const spanStart = out.siteVertex.length
    for (let cost = 0; cost <= MAX_PAID_BUILDS; cost += 1) {
      const band = bands[cost]
      for (let head = 0; head < band.length; head += 1) {
        const state = band[head]
        if (scratch.settled[state] === walk) continue
        scratch.settled[state] = walk
        const index = state >> 1
        const roadUsed = (state & 1) === 1
        // Every vertex past the first step is at least two edges out; the adjacency test in
        // `isSite` drops the ones that are two edges out but still touch the candidate.
        //
        // The two road-spent lanes settle a vertex separately, so one site can be popped twice:
        // once over the seat's own roads and once over the free setup road. Bands drain
        // cheapest-first, so the first pop is the cheapest one; recording the repeat would let
        // the top-two fold pair a site with itself. `recorded` is keyed by vertex alone,
        // `settled` by state.
        if (index !== first.to && scratch.recorded[index] !== walk && isSite(index)) {
          scratch.recorded[index] = walk
          out.siteVertex.push(index)
          out.sitePaid.push(cost)
        }
        if (rival(index)) continue
        for (const step of steps[index]) {
          const owner = edgeOwner.get(step.edgeId)
          if (owner !== undefined && owner !== seat) continue
          const unowned = owner === undefined
          const nextCost = cost + (unowned && roadUsed ? 1 : 0)
          if (nextCost > MAX_PAID_BUILDS) continue
          const next = packState(step.to, roadUsed || unowned)
          if (scratch.settled[next] === walk) continue
          bands[nextCost].push(next)
        }
      }
    }
    if (out.siteVertex.length > spanStart) {
      out.edgeIds.push(first.edgeId)
      out.edgeStart.push(spanStart)
      out.edgeEnd.push(out.siteVertex.length)
    }
  }
  return scratch
}

export interface ExpansionValue {
  /** The term, already multiplied by `expansionWeight`. */
  value: number
  /** The setup road to lay, or null when the candidate opens nothing. */
  road: EdgeId | null
}

const NO_EXPANSION: ExpansionValue = { value: 0, road: null }

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
  const scratch = walkSites(ctx.layout, occupancy, own, candidate)
  if (scratch === null) return NO_EXPANSION
  const out = scratch.output
  if (out.edgeIds.length === 0) return NO_EXPANSION
  const { vertexIds } = roadGraph(ctx.layout)
  const withCandidate = addToHoldings(ctx, holdings, candidate)
  scratch.term += 1
  const term = scratch.term
  scratch.touched.length = 0

  // One score per site, shared by every first edge that reaches it: a site's worth depends on the
  // site and the pair, never on the road taken to get there.
  const discounted = (vertex: number, paidBuilds: number): number => {
    if (scratch.scoreStamp[vertex] !== term) {
      scratch.scoreStamp[vertex] = term
      // No draft slot: a site is a settlement some later turn buys, so what the pair's *current*
      // pick position leans on says nothing about it. SP4's scales price this whole term instead,
      // through the `expansion` scale its caller applies. `placement/expansion.rs::term` matches.
      scratch.score[vertex] = marginalWithoutExpansion(ctx, withCandidate, vertexIds[vertex])
    }
    return scratch.score[vertex] * weights.expansionDecay ** paidBuilds
  }

  let road: EdgeId | null = null
  let bestSite = -Infinity
  let bestPair = -Infinity
  for (let edge = 0; edge < out.edgeIds.length; edge += 1) {
    const firstEdge = out.edgeIds[edge]
    const spanEnd = out.edgeEnd[edge]

    // Fold the two best values and each site's cheapest reach in one pass. Folding reach by
    // value would favor expensive paths for negative scores, because decay shrinks them toward 0.
    // `placement/expansion.rs::term` uses the same rule.
    let first = -Infinity
    let second = -Infinity
    let sawNaN = false
    for (let index = out.edgeStart[edge]; index < spanEnd; index += 1) {
      const vertex = out.siteVertex[index]
      const paidBuilds = out.sitePaid[index]
      const value = discounted(vertex, paidBuilds)
      if (value > first) {
        second = first
        first = value
      } else if (value > second) {
        second = value
      } else if (Number.isNaN(value)) {
        sawNaN = true
      }
      if (scratch.cheapStamp[vertex] !== term) {
        scratch.cheapStamp[vertex] = term
        scratch.cheapPaid[vertex] = paidBuilds
        scratch.cheapValue[vertex] = value
        scratch.touched.push(vertex)
      } else if (paidBuilds < scratch.cheapPaid[vertex]) {
        scratch.cheapPaid[vertex] = paidBuilds
        scratch.cheapValue[vertex] = value
      }
    }
    // The site reading is a `Math.max`, which a NaN poisons, while the pair skips it. The two
    // differ only there, and `placement/expansion.rs` splits them the same way, `js_max` against
    // `top_two`. The span is never empty: an edge only reaches `edgeIds` once it has a site.
    const best = sawNaN ? NaN : first
    const pair = first === -Infinity ? 0 : second === -Infinity ? first : first + second
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
  }

  // The two best sites the candidate reaches over any first edge, each at its cheapest reach.
  let best = -Infinity
  let second = -Infinity
  for (const vertex of scratch.touched) {
    const value = scratch.cheapValue[vertex]
    if (value > best) {
      second = best
      best = value
    } else if (value > second) {
      second = value
    }
  }
  const reached = best === -Infinity ? 0 : second === -Infinity ? best : best + second
  return { value: weights.expansionWeight * reached, road }
}
