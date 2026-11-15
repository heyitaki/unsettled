import { axialKey, edgeEndpointVertexIds, parseEdgeId, parseVertexId } from '../model/coords'
import type { AxialCoord, Board, Resource, TileKind, VertexId } from '../model/types'

export const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

/** What a vertex touches: its hexes, then any port on an edge it ends. */
export type VertexPart =
  | { kind: 'hex'; coord: AxialCoord; tile: TileKind | null; number: number | null }
  | { kind: 'port'; coord: AxialCoord; tile: Resource | null; rate: number }

/** The board's hexes at `coords`, each once, in board order; sea coords give nothing. */
export function hexParts(board: Board, coords: AxialCoord[]): VertexPart[] {
  const keys = new Set(coords.map(axialKey))
  return board.hexes
    .filter((hex) => keys.has(axialKey(hex.coord)))
    .map((hex): VertexPart => ({ kind: 'hex', coord: hex.coord, tile: hex.tile, number: hex.numberToken }))
}

export function vertexParts(board: Board, vertexId: VertexId): VertexPart[] {
  const land = new Set(board.hexes.map((hex) => axialKey(hex.coord)))
  const hexes = hexParts(board, parseVertexId(vertexId))
  const ports = board.ports
    .filter((port) => edgeEndpointVertexIds(port.edgeId).includes(vertexId))
    .map((port): VertexPart => {
      const edge = parseEdgeId(port.edgeId)
      const coord = edge.find((member) => !land.has(axialKey(member))) ?? edge[0]
      return { kind: 'port', coord, tile: port.resource, rate: port.rate }
    })
  return [...hexes, ...ports]
}

/** Parts in words, for tooltips and accessible names. */
export function partsDescription(parts: VertexPart[]): string {
  return parts.map((part) => {
    if (part.kind === 'hex') {
      if (part.tile === 'desert') return 'Desert'
      if (part.tile === null) return 'Unassigned'
      return `${RESOURCE_LABELS[part.tile]} ${part.number ?? '?'}`
    }
    return part.tile === null ? `${part.rate}:1 port` : `${RESOURCE_LABELS[part.tile]} ${part.rate}:1 port`
  }).join(' · ')
}

export function vertexDescription(board: Board, vertexId: VertexId): string {
  return partsDescription(vertexParts(board, vertexId))
}
