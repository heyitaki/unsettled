import { vertexAdjacentVertexIds } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Board, LayoutId, VertexId } from '../model/types'

const adjacencyCache = new Map<LayoutId, ReadonlyMap<VertexId, readonly VertexId[]>>()

export function vertexAdjacency(layout: LayoutId): ReadonlyMap<VertexId, readonly VertexId[]> {
  const cached = adjacencyCache.get(layout)
  if (cached) return cached
  const grid = boardGrid(layout)
  const inGrid = new Set(grid.vertexIds)
  const adjacency = new Map<VertexId, readonly VertexId[]>()
  for (const vertexId of grid.vertexIds) {
    adjacency.set(vertexId, vertexAdjacentVertexIds(vertexId).filter((neighbor) => inGrid.has(neighbor)))
  }
  adjacencyCache.set(layout, adjacency)
  return adjacency
}

const occupiedVertices = (board: Board): Set<VertexId> =>
  new Set(board.buildings.map((building) => building.vertexId))

export function blockVertex(
  adjacency: ReadonlyMap<VertexId, readonly VertexId[]>,
  blocked: Set<VertexId>,
  vertexId: VertexId,
): void {
  blocked.add(vertexId)
  for (const neighbor of adjacency.get(vertexId) ?? []) blocked.add(neighbor)
}

export function blockedVertices(layout: LayoutId, occupied: Iterable<VertexId>): Set<VertexId> {
  const adjacency = vertexAdjacency(layout)
  const blocked = new Set<VertexId>()
  for (const vertexId of occupied) blockVertex(adjacency, blocked, vertexId)
  return blocked
}

export function legalSettlementVertices(board: Board, extraOccupied: Iterable<VertexId> = []): VertexId[] {
  const occupied = occupiedVertices(board)
  for (const vertexId of extraOccupied) occupied.add(vertexId)
  const blocked = blockedVertices(board.layout, occupied)
  return boardGrid(board.layout).vertexIds.filter((vertexId) => !blocked.has(vertexId))
}
