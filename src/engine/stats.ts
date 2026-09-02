// Live-game standings derived from a Game: piece counts and longest road come
// off the board, hands/dev cards/knights from game.stats, and the two award
// bonuses are auto-assigned from those. Pure functions, no React.

import { edgeEndpointVertexIds } from '../model/coords'
import type { Game } from '../model/game'
import type { Board, EdgeId, VertexId } from '../model/types'

export const SUPER_CITY_VP = 3

const LONGEST_ROAD_MIN = 5
const LARGEST_ARMY_MIN = 3

// Trail enumeration is exponential in road density, and nothing caps a player at
// 15 roads: all 72 edges owned by one player took ~22s exhaustively, freezing the
// tab. Past the budget the search returns its best trail so far — a lower bound,
// but only reachable by boards no legal game produces.
const TRAVERSAL_BUDGET = 200_000

export interface PlayerStanding {
  playerId: string
  settlements: number
  cities: number
  superCities: number
  roads: number
  longestRoad: number
  hasLongestRoad: boolean
  hasLargestArmy: boolean
  victoryPoints: number
}

/**
 * Length of the player's longest single road: the longest trail (each road
 * used once) through their road network. An opponent's building breaks the
 * road at its vertex — a trail may end there but not pass through. Exhaustive
 * DFS is fine at Catan scale (15 roads per player).
 */
export function longestRoadLength(board: Board, playerId: string): number {
  const edges = board.roads.filter((road) => road.playerId === playerId).map((road) => road.edgeId)
  return runLength(edges, blockedFor(board, playerId))
}

/** Vertices where an opponent's building breaks this player's road. */
const blockedFor = (board: Board, playerId: string): Set<VertexId> => new Set(
  board.buildings.filter((building) => building.playerId !== playerId).map((building) => building.vertexId),
)

function runLength(edges: readonly EdgeId[], blocked: ReadonlySet<VertexId>): number {
  if (edges.length === 0) return 0
  const endpoints = edges.map((edge) => edgeEndpointVertexIds(edge))
  const incident = new Map<VertexId, number[]>()
  endpoints.forEach((vertices, index) => {
    for (const vertex of vertices) {
      const list = incident.get(vertex)
      if (list) list.push(index)
      else incident.set(vertex, [index])
    }
  })
  let best = 0
  let traversals = 0
  const used = new Array<boolean>(edges.length).fill(false)
  const walk = (vertex: VertexId, length: number): void => {
    if (length > best) best = length
    // Starting beside an opponent building is legal; passing through is not.
    if (length > 0 && blocked.has(vertex)) return
    for (const index of incident.get(vertex) ?? []) {
      if (used[index]) continue
      if (traversals >= TRAVERSAL_BUDGET) return
      traversals += 1
      used[index] = true
      const next = endpoints[index][0] === vertex ? endpoints[index][1] : endpoints[index][0]
      walk(next, length + 1)
      used[index] = false
    }
  }
  for (const vertex of incident.keys()) walk(vertex, 0)
  return best
}

/**
 * Who holds longest road, by replaying road placements in board order: the
 * first player to reach the minimum takes the card and keeps it until someone
 * else *beats* their run — matching it is not enough. Board order is placement
 * order for boards built in the editor; an imported board carries the parser's
 * spatial order, so its holder is best-effort, the same caveat the draft
 * slot mapping carries.
 *
 * Blocking uses the final buildings rather than replaying those too: the board
 * records no placement order across piece types, and a settlement dropped on an
 * opponent's road only ever shortens a run that already earned the card.
 */
function longestRoadHolder(board: Board): string | null {
  let holder: string | null = null
  let holderRun = LONGEST_ROAD_MIN - 1
  const laid = new Map<string, EdgeId[]>()
  const blocked = new Map<string, Set<VertexId>>()
  for (const road of board.roads) {
    const edges = laid.get(road.playerId) ?? []
    edges.push(road.edgeId)
    laid.set(road.playerId, edges)
    // Below the minimum no run can qualify, so skip the short prefixes and keep
    // the replay near the cost of a single pass.
    if (edges.length < LONGEST_ROAD_MIN) continue
    let own = blocked.get(road.playerId)
    if (!own) {
      own = blockedFor(board, road.playerId)
      blocked.set(road.playerId, own)
    }
    const run = runLength(edges, own)
    if (run < LONGEST_ROAD_MIN) continue
    if (road.playerId === holder) holderRun = run
    else if (run > holderRun) {
      holder = road.playerId
      holderRun = run
    }
  }
  return holder
}

// The award holder is the unique owner of the maximum at or above the
// threshold. On a tie we award nobody: knights carry no placement order, so
// unlike longest road there is no way to know who reached the max first.
function uniqueMaxHolder(values: ReadonlyMap<string, number>, threshold: number): string | null {
  let holder: string | null = null
  let max = threshold - 1
  for (const [playerId, value] of values) {
    if (value > max) {
      max = value
      holder = playerId
    } else if (value === max) holder = null
  }
  return holder
}

// Memoized on game identity like analyzeBoardCached: PlayerPanel needs standings
// every render, and games are immutable, so identity is a safe key. readonly so
// no caller can sort the shared array in place and corrupt the cache.
const standingsCache = new WeakMap<Game, readonly PlayerStanding[]>()

/** Standings for every player, in roster order. */
export function computeStandings(game: Game): readonly PlayerStanding[] {
  const hit = standingsCache.get(game)
  if (hit) return hit
  const standings = standingsFor(game)
  standingsCache.set(game, standings)
  return standings
}

function standingsFor(game: Game): PlayerStanding[] {
  const { board, stats } = game
  const counts = board.players.map((player) => {
    const buildings = board.buildings.filter((building) => building.playerId === player.id)
    const tally = (tier: string) => buildings.filter((building) => building.tier === tier).length
    return {
      playerId: player.id,
      settlements: tally('settlement'),
      cities: tally('city'),
      superCities: tally('superCity'),
      roads: board.roads.filter((road) => road.playerId === player.id).length,
      longestRoad: longestRoadLength(board, player.id),
    }
  })
  const roadHolder = longestRoadHolder(board)
  const armyHolder = uniqueMaxHolder(
    new Map(board.players.map((player) => [player.id, stats[player.id]?.knights ?? 0])),
    LARGEST_ARMY_MIN,
  )
  return counts.map((entry) => {
    const hasLongestRoad = entry.playerId === roadHolder
    const hasLargestArmy = entry.playerId === armyHolder
    return {
      ...entry,
      hasLongestRoad,
      hasLargestArmy,
      victoryPoints: entry.settlements + 2 * entry.cities + SUPER_CITY_VP * entry.superCities +
        (hasLongestRoad ? 2 : 0) + (hasLargestArmy ? 2 : 0) + (stats[entry.playerId]?.vpCards ?? 0),
    }
  })
}
