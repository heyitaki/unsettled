import type { AxialCoord, EdgeId, VertexId } from './types'

const DIRS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
]

const compareCoords = (a: AxialCoord, b: AxialCoord): number => a.q - b.q || a.r - b.r

export const axialKey = (coord: AxialCoord): string => `${coord.q},${coord.r}`

export function parseAxialKey(key: string): AxialCoord {
  const match = /^(-?\d+),(-?\d+)$/.exec(key)
  if (!match) throw new Error(`Invalid axial coordinate: ${key}`)
  return { q: Number(match[1]), r: Number(match[2]) }
}

export function neighbor(coord: AxialCoord, direction: number): AxialCoord {
  const delta = DIRS[((direction % 6) + 6) % 6]
  return { q: coord.q + delta.q, r: coord.r + delta.r }
}

export function vertexTripleAt(hex: AxialCoord, corner: number): [AxialCoord, AxialCoord, AxialCoord] {
  return [hex, neighbor(hex, corner), neighbor(hex, corner + 1)].sort(compareCoords) as [
    AxialCoord,
    AxialCoord,
    AxialCoord,
  ]
}

export const vertexIdOf = (triple: readonly AxialCoord[]): VertexId =>
  `v:${[...triple].sort(compareCoords).map(axialKey).join(';')}`

export function parseVertexId(id: VertexId | string): [AxialCoord, AxialCoord, AxialCoord] {
  if (!id.startsWith('v:')) throw new Error(`Invalid vertex ID: ${id}`)
  const coords = id.slice(2).split(';').map(parseAxialKey)
  if (coords.length !== 3 || vertexIdOf(coords) !== id) throw new Error(`Invalid vertex ID: ${id}`)
  return coords as [AxialCoord, AxialCoord, AxialCoord]
}

export function edgePairAt(hex: AxialCoord, direction: number): [AxialCoord, AxialCoord] {
  return [hex, neighbor(hex, direction)].sort(compareCoords) as [AxialCoord, AxialCoord]
}

export const edgeIdOf = (pair: readonly AxialCoord[]): EdgeId =>
  `e:${[...pair].sort(compareCoords).map(axialKey).join(';')}`

export function parseEdgeId(id: EdgeId | string): [AxialCoord, AxialCoord] {
  if (!id.startsWith('e:')) throw new Error(`Invalid edge ID: ${id}`)
  const coords = id.slice(2).split(';').map(parseAxialKey)
  if (coords.length !== 2 || edgeIdOf(coords) !== id) throw new Error(`Invalid edge ID: ${id}`)
  return coords as [AxialCoord, AxialCoord]
}

export const hexVertexIds = (hex: AxialCoord): VertexId[] =>
  Array.from({ length: 6 }, (_, corner) => vertexIdOf(vertexTripleAt(hex, corner)))

export const hexEdgeIds = (hex: AxialCoord): EdgeId[] =>
  Array.from({ length: 6 }, (_, direction) => edgeIdOf(edgePairAt(hex, direction)))

export function edgeEndpointVertexIds(edgeId: EdgeId | string): VertexId[] {
  const [a, b] = parseEdgeId(edgeId)
  const ids = new Set<VertexId>()
  for (let corner = 0; corner < 6; corner += 1) {
    const triple = vertexTripleAt(a, corner)
    if (triple.some((coord) => compareCoords(coord, b) === 0)) ids.add(vertexIdOf(triple))
  }
  return [...ids].sort()
}

export function vertexIncidentEdgeIds(vertexId: VertexId | string): EdgeId[] {
  const [a, b, c] = parseVertexId(vertexId)
  return [edgeIdOf([a, b]), edgeIdOf([a, c]), edgeIdOf([b, c])].sort()
}

export function vertexAdjacentVertexIds(vertexId: VertexId | string): VertexId[] {
  const adjacent = new Set<VertexId>()
  for (const edgeId of vertexIncidentEdgeIds(vertexId)) {
    for (const endpoint of edgeEndpointVertexIds(edgeId)) {
      if (endpoint !== vertexId) adjacent.add(endpoint)
    }
  }
  return [...adjacent].sort()
}

export const vertexTouchingHexes = (vertexId: VertexId | string): AxialCoord[] =>
  parseVertexId(vertexId)

export function axialToPixel(coord: AxialCoord, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r,
  }
}
