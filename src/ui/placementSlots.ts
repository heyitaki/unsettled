import { edgeEndpointVertexIds, vertexAdjacentVertexIds } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Board, BuildingTier, EdgeId } from '../model/types'

export function newPortEdges(board: Board): EdgeId[] {
  const occupied = new Set(board.ports.flatMap((port) => edgeEndpointVertexIds(port.edgeId)))
  return boardGrid(board.layout).coastalEdgeIds.filter((edgeId) =>
    edgeEndpointVertexIds(edgeId).every((vertexId) => !occupied.has(vertexId)))
}

export function nearestTarget(point: { x: number; y: number }, targets: readonly { ref: string; x: number; y: number }[], maxDistance: number): string | null {
  let nearest: string | null = null
  let distance = maxDistance
  for (const target of targets) {
    const next = Math.hypot(target.x - point.x, target.y - point.y)
    if (next <= distance) {
      nearest = target.ref
      distance = next
    }
  }
  return nearest
}

/**
 * The target a click acts on. A click within `repeat` of the previous one stays on that click's
 * target, so a corner keeps cycling after its roads become legal; a click within `direct` of
 * another target is on that target's own dot or piece, and acts on it.
 */
export function clickTarget(point: { x: number; y: number }, targets: readonly { ref: string; x: number; y: number }[], previous: { ref: string; x: number; y: number } | null, reach: { max: number; repeat: number; direct: number }): string | null {
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > reach.repeat) return nearestTarget(point, targets, reach.max)
  const direct = nearestTarget(point, targets, reach.direct)
  if (direct !== null && direct !== previous.ref) return direct
  return targets.some((target) => target.ref === previous.ref) ? previous.ref : null
}

export function nextBuildingTier(current: BuildingTier | undefined, allow: { city: boolean; superCity: boolean }): BuildingTier | null {
  if (current === undefined) return 'settlement'
  if (current === 'settlement' && allow.city) return 'city'
  if (current === 'city' && allow.superCity) return 'superCity'
  return null
}

export function buildingSlots(board: Board, playerId: string | null, tier: BuildingTier, mode: 'edit' | 'build') {
  if (playerId === null) return []
  const connected = new Set(board.roads.filter((road) => road.playerId === playerId).flatMap((road) => edgeEndpointVertexIds(road.edgeId)))
  const byVertex = new Map(board.buildings.map((building) => [building.vertexId, building]))
  return boardGrid(board.layout).vertexIds.filter((vertexId) => {
    const here = byVertex.get(vertexId)
    if (mode === 'build' && tier === 'city') return here?.playerId === playerId && here.tier === 'settlement'

    // Editor tools mirror a live game: any tier can occupy a distance-legal empty vertex.
    if (!here) return (mode === 'edit' || connected.has(vertexId)) && vertexAdjacentVertexIds(vertexId).every((adjacent) => !byVertex.has(adjacent))

    // Slot rules never change ownership.
    return mode === 'edit' && here.playerId === playerId && here.tier !== tier
  })
}

export function roadSlots(board: Board, playerId: string | null, chosen: readonly EdgeId[] = []) {
  if (playerId === null) return []
  const occupied = new Set([...board.roads.map((road) => road.edgeId), ...chosen])
  const ownBuildings = new Set(board.buildings.filter((building) => building.playerId === playerId).map((building) => building.vertexId))
  const opponents = new Set(board.buildings.filter((building) => building.playerId !== playerId).map((building) => building.vertexId))
  const ownRoads = [...board.roads.filter((road) => road.playerId === playerId).map((road) => road.edgeId), ...chosen]
  const connected = new Set(ownRoads.flatMap(edgeEndpointVertexIds))

  // Connect to your building or your road through a vertex no opponent building blocks.
  return boardGrid(board.layout).edgeIds.filter((edgeId) => !occupied.has(edgeId) && edgeEndpointVertexIds(edgeId).some((vertex) =>
    ownBuildings.has(vertex) || (connected.has(vertex) && !opponents.has(vertex))))
}
