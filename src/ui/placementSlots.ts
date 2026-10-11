import { edgeEndpointVertexIds, vertexAdjacentVertexIds } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Board, BuildingTier, EdgeId } from '../model/types'

export function buildingSlots(board: Board, playerId: string | null, tier: BuildingTier, mode: 'edit' | 'build') {
  if (playerId === null) return []
  const connected = new Set(board.roads.filter((road) => road.playerId === playerId).flatMap((road) => edgeEndpointVertexIds(road.edgeId)))
  const byVertex = new Map(board.buildings.map((building) => [building.vertexId, building]))
  return boardGrid(board.layout).vertexIds.filter((vertexId) => {
    const here = byVertex.get(vertexId)
    if (mode === 'build' && tier === 'city') return here?.playerId === playerId && here.tier === 'settlement'

    // Editor tools mirror a live game: any tier can occupy a distance-legal empty vertex.
    if (!here) return (mode === 'edit' || connected.has(vertexId)) && vertexAdjacentVertexIds(vertexId).every((adjacent) => !byVertex.has(adjacent))

    // Re-tier only your own pieces so the city tool cannot take a rival's settlement.
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
