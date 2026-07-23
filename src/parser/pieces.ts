import { parseEdgeId, parseVertexId } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Building, Road } from '../model/types'
import { colorDistanceSquared, pixel, type Rgb, type RgbaImage } from './image'
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
  const ownerAt = (x: number, y: number): PieceOwner | null => {
    const color = pixel(image, x, y)
    let best: PieceOwner | null = null
    let distance = 22 ** 2
    for (const owner of owners) {
      const candidate = colorDistanceSquared(color, owner.anchor)
      if (candidate <= distance) {
        distance = candidate
        best = owner
      }
    }
    return best
  }
  const seen = new Set<string>()
  const components: PieceComponent[] = []
  for (let y = registration.bandTop; y <= registration.bandBottom; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const key = `${x},${y}`
      if (seen.has(key)) continue
      const owner = ownerAt(x, y)
      if (!owner) continue
      const stack: [number, number][] = [[x, y]]
      seen.add(key)
      let area = 0
      let sumX = 0
      let sumY = 0
      while (stack.length > 0) {
        const current = stack.pop()
        if (!current) break
        const [currentX, currentY] = current
        area += 1
        sumX += currentX
        sumY += currentY
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nextX = currentX + dx
          const nextY = currentY + dy
          const nextKey = `${nextX},${nextY}`
          if (nextX < 0 || nextX >= image.width || nextY < registration.bandTop ||
            nextY > registration.bandBottom || seen.has(nextKey)) continue
          if (ownerAt(nextX, nextY)?.id === owner.id) {
            seen.add(nextKey)
            stack.push([nextX, nextY])
          }
        }
      }
      if (area >= 0.024 * registration.size ** 2) {
        components.push({ playerId: owner.id, x: sumX / area, y: sumY / area, area })
      }
    }
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
