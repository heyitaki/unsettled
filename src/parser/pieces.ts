import { parseEdgeId, parseVertexId } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Building, EdgeId, Road, VertexId } from '../model/types'
import { labelComponents, neighbors } from './components'
import { nearColor, pixel, type Rgb, type RgbaImage } from './image'
import { nearest, type ParserPalette } from './palette'
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
  palette: ParserPalette,
  registration: Registration,
  owners: PieceOwner[],
): DetectedPieces {
  const entries = owners.map((owner) => [owner.id, owner.anchor] as const)
  const components: PieceComponent[] = []
  const points: [number, number][] = []
  const classify = (x: number, y: number) => nearest(pixel(image, x, y), entries, 22)
  for (const component of labelComponents(
    { minX: registration.bandLeft, maxX: registration.bandRight, minY: registration.bandTop, maxY: registration.bandBottom },
    classify,
    { visit: (x, y) => points.push([x, y]) },
  )) {
    const { label: playerId, x, y, area } = component
    if (area >= 0.024 * registration.size ** 2) {
      let perimeter = 0
      let outlined = 0
      for (const [px, py] of points) {
        for (const [dx, dy] of neighbors) {
          if (classify(px + dx, py + dy) === playerId) continue
          perimeter += 1
          for (let distance = 1; distance <= Math.ceil(0.03 * registration.size); distance += 1) {
            if (nearColor(pixel(image, px + dx * distance, py + dy * distance), palette.inkDark, 35)) {
              outlined += 1
              break
            }
          }
        }
      }

      // Blinking placement discs can match a seat colour but have no outline.
      if (outlined > 0.6 * perimeter) components.push({ playerId, x, y, area })
    }
    points.length = 0
  }
  const grid = boardGrid(registration.layout)
  const vertices = grid.vertexIds.map((vertexId) => {
    const [x, y] = vertexPoint(registration, vertexId)
    return { vertexId, x, y }
  })
  const edges = grid.edgeIds.map((edgeId) => {
    const [x, y] = edgePoint(registration, edgeId)
    return { edgeId, x, y }
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

export function orderDraftSettlements(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
  buildings: Building[],
  seatIds: string[],
): { buildings: Building[]; unorderedPlayerIds: string[]; ordered: boolean } {
  const byPlayer = seatIds.map((id) => buildings.filter((building) => building.playerId === id))
  const draftShape = buildings.every((building) => building.tier === 'settlement') &&
    byPlayer.every((placed) => placed.length <= 2)
  if (!draftShape) return { buildings, unorderedPlayerIds: [], ordered: false }
  const incomplete = byPlayer.some((placed) => placed.length < 2)
  const unorderedPlayerIds: string[] = []
  let ordered = true
  for (const placed of byPlayer) {
    if (placed.length !== 2) continue
    const [first, second] = placed.map((building) => readSettlementOrdinal(image, palette, registration, building.vertexId))
    if (first === second) {
      ordered = false
      if (incomplete) unorderedPlayerIds.push(placed[0].playerId)
    } else if (first === 2 || second === 1) placed.reverse()
  }
  return { buildings: snakeOrder(byPlayer), unorderedPlayerIds, ordered }
}

export function snakeOrder<T>(byPlayer: readonly (readonly T[])[]): T[] {
  return [...byPlayer.flatMap((placed) => placed.slice(0, 1)),
    ...[...byPlayer].reverse().flatMap((placed) => placed.slice(1, 2))]
}

export function edgePoint(registration: Pick<Registration, 'center'>, edgeId: EdgeId): [number, number] {
  const [a, b] = parseEdgeId(edgeId).map(registration.center)
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

export function vertexPoint(registration: Pick<Registration, 'center'>, vertexId: VertexId): [number, number] {
  const centers = parseVertexId(vertexId).map(registration.center)
  return [
    centers.reduce((sum, center) => sum + center[0], 0) / 3,
    centers.reduce((sum, center) => sum + center[1], 0) / 3,
  ]
}

export function readSettlementOrdinal(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
  vertexId: VertexId,
): 1 | 2 | null {
  const [x, y] = vertexPoint(registration, vertexId)
  const size = registration.size
  const bounds = {
    minX: Math.max(0, Math.round(x + 0.08 * size)),
    maxX: Math.min(image.width - 1, Math.round(x + 0.55 * size)),
    minY: Math.max(0, Math.round(y - 0.45 * size)),
    maxY: Math.min(image.height - 1, Math.round(y + 0.1 * size)),
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return null
  for (const disc of labelComponents(
    bounds,
    (px, py) => nearColor(pixel(image, px, py), palette.tokenCream, 18) ? true : null,
  )) {
    const width = disc.maxX - disc.minX + 1
    const height = disc.maxY - disc.minY + 1
    if (width < 0.2 * size || width > 0.34 * size || Math.abs(width / height - 1) > 0.2) continue
    const bars = [...labelComponents(
      {
        minX: Math.ceil(disc.minX + 0.2 * width),
        maxX: Math.floor(disc.maxX - 0.2 * width),
        minY: Math.ceil(disc.minY + 0.2 * height),
        maxY: Math.floor(disc.maxY - 0.2 * height),
      },
      (px, py) => nearColor(pixel(image, px, py), palette.inkDark, 55) ? true : null,
    )].filter((bar) => {
      const barHeight = bar.maxY - bar.minY + 1
      const barWidth = bar.maxX - bar.minX + 1
      const tallEnough = barHeight > 0.25 * height && barHeight < 0.65 * height
      return tallEnough && barWidth < 0.5 * barHeight
    })
    if (bars.length === 1 || bars.length === 2) return bars.length
  }
  return null
}
