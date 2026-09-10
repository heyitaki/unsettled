import { parseEdgeId, parseVertexId } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Building, Road } from '../model/types'
import { labelComponents } from './components'
import { pixel, type Rgb, type RgbaImage } from './image'
import { nearest } from './palette'
import type { Registration } from './registration'

export interface PieceOwner {
  id: string
  anchor: Rgb
}

export interface DetectedPieces {
  roads: Road[]
  buildings: Building[]
  usedPlayerIds: Set<string>
  ignored: number
  duplicates: number
}

interface PieceComponent {
  playerId: string
  x: number
  y: number
  area: number
}

export function detectPieces(
  image: RgbaImage,
  registration: Registration,
  owners: PieceOwner[],
): DetectedPieces {
  const entries = owners.map((owner) => [owner.id, owner.anchor] as const)
  const components: PieceComponent[] = []
  for (const component of labelComponents(
    { minX: 0, maxX: image.width - 1, minY: registration.bandTop, maxY: registration.bandBottom },
    (x, y) => nearest(pixel(image, x, y), entries, 22),
  )) {
    const { label: playerId, x, y, area } = component
    if (area >= 0.024 * registration.size ** 2) components.push({ playerId, x, y, area })
  }
  const grid = boardGrid(registration.layout)
  const vertices = grid.vertexIds.map((vertexId) => {
    const centers = parseVertexId(vertexId).map(registration.center)
    return {
      vertexId,
      x: centers.reduce((sum, center) => sum + center[0], 0) / 3,
      y: centers.reduce((sum, center) => sum + center[1], 0) / 3,
    }
  })
  const edges = grid.edgeIds.map((edgeId) => {
    const centers = parseEdgeId(edgeId).map(registration.center)
    return {
      edgeId,
      x: (centers[0][0] + centers[1][0]) / 2,
      y: (centers[0][1] + centers[1][1]) / 2,
    }
  })
  const roads = new Map<string, Road & { area: number }>()
  const buildings = new Map<string, Building & { area: number }>()
  const usedPlayerIds = new Set<string>()
  let ignored = 0
  let duplicates = 0
  for (const component of components.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const vertex = vertices.map((candidate) => ({
      ...candidate,
      distance: Math.hypot(candidate.x - component.x, candidate.y - component.y),
    })).sort((a, b) => a.distance - b.distance)[0]
    const edge = edges.map((candidate) => ({
      ...candidate,
      distance: Math.hypot(candidate.x - component.x, candidate.y - component.y),
    })).sort((a, b) => a.distance - b.distance)[0]
    if (Math.min(vertex.distance, edge.distance) > 0.3 * registration.size) {
      ignored += 1
      continue
    }
    usedPlayerIds.add(component.playerId)
    if (vertex.distance <= edge.distance) {
      const tier = component.area < 0.13 * registration.size ** 2
        ? 'settlement'
        : component.area < 0.24 * registration.size ** 2 ? 'city' : 'superCity'
      const existing = buildings.get(vertex.vertexId)
      if (existing) duplicates += 1
      if (!existing || component.area > existing.area) {
        buildings.set(vertex.vertexId, {
          vertexId: vertex.vertexId,
          playerId: component.playerId,
          tier,
          area: component.area,
        })
      }
    } else {
      const existing = roads.get(edge.edgeId)
      if (existing) duplicates += 1
      if (!existing || component.area > existing.area) {
        roads.set(edge.edgeId, { edgeId: edge.edgeId, playerId: component.playerId, area: component.area })
      }
    }
  }
  return {
    roads: [...roads.values()].map(({ edgeId, playerId }) => ({ edgeId, playerId })),
    buildings: [...buildings.values()].map(({ vertexId, playerId, tier }) => ({ vertexId, playerId, tier })),
    usedPlayerIds,
    ignored,
    duplicates,
  }
}
