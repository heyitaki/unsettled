import {
  axialKey,
  axialToPixel,
  edgeIdOf,
  edgePairAt,
  hexEdgeIds,
  hexVertexIds,
  parseEdgeId,
} from './coords'
import type { AxialCoord, EdgeId, Hex, LayoutId, VertexId } from './types'

interface RowSpec {
  r: number
  qStart: number
  count: number
}

export const ROWS_STANDARD4: readonly RowSpec[] = [
  { r: -2, qStart: 0, count: 3 },
  { r: -1, qStart: -1, count: 4 },
  { r: 0, qStart: -2, count: 5 },
  { r: 1, qStart: -2, count: 4 },
  { r: 2, qStart: -2, count: 3 },
]

export const ROWS_EXTENSION6: readonly RowSpec[] = [
  { r: -3, qStart: 0, count: 3 },
  { r: -2, qStart: -1, count: 4 },
  { r: -1, qStart: -2, count: 5 },
  { r: 0, qStart: -3, count: 6 },
  { r: 1, qStart: -3, count: 5 },
  { r: 2, qStart: -3, count: 4 },
  { r: 3, qStart: -3, count: 3 },
]

export interface BoardGrid {
  landCoords: AxialCoord[]
  landKeys: Set<string>
  vertexIds: VertexId[]
  edgeIds: EdgeId[]
  coastalEdgeIds: EdgeId[]
}

const cache = new Map<LayoutId, BoardGrid>()

function rowsFor(layout: LayoutId): readonly RowSpec[] {
  return layout === 'standard4' ? ROWS_STANDARD4 : ROWS_EXTENSION6
}

export function boardGrid(layout: LayoutId): BoardGrid {
  const cached = cache.get(layout)
  if (cached) return cached
  const landCoords = rowsFor(layout).flatMap(({ r, qStart, count }) =>
    Array.from({ length: count }, (_, index) => ({ q: qStart + index, r })),
  )
  const landKeys = new Set(landCoords.map(axialKey))
  const vertices = new Set<VertexId>()
  const edges = new Set<EdgeId>()
  for (const coord of landCoords) {
    hexVertexIds(coord).forEach((id) => vertices.add(id))
    hexEdgeIds(coord).forEach((id) => edges.add(id))
  }
  const coastalEdgeIds = [...edges].filter((id) =>
    parseEdgeId(id).filter((coord) => landKeys.has(axialKey(coord))).length === 1,
  ).sort()
  const grid = {
    landCoords,
    landKeys,
    vertexIds: [...vertices].sort(),
    edgeIds: [...edges].sort(),
    coastalEdgeIds,
  }
  cache.set(layout, grid)
  return grid
}

export const PORT_EDGES_STANDARD4: EdgeId[] = [
  'e:-2,-1;-2,0',
  'e:-1,-2;0,-2',
  'e:1,-2;2,-3',
  'e:2,-2;3,-2',
  'e:2,0;3,-1',
  'e:1,1;1,2',
  'e:-1,3;0,2',
  'e:-2,2;-2,3',
  'e:-3,1;-2,1',
]

export const PORT_EDGES_EXTENSION6: EdgeId[] = [
  'e:0,-4;0,-3',
  'e:-2,-2;-1,-2',
  'e:2,-2;3,-2',
  'e:-3,-1;-3,0',
  'e:2,0;3,-1',
  'e:-4,1;-3,1',
  'e:1,1;2,1',
  'e:-4,3;-3,2',
  'e:-3,3;-3,4',
  'e:-2,4;-1,3',
  'e:0,2;0,3',
]

export const defaultPortEdges = (layout: LayoutId): EdgeId[] =>
  layout === 'standard4' ? [...PORT_EDGES_STANDARD4] : [...PORT_EDGES_EXTENSION6]

export function edgeMidpoint(edgeId: EdgeId, size: number): { x: number; y: number } {
  const [a, b] = parseEdgeId(edgeId)
  const ap = axialToPixel(a, size)
  const bp = axialToPixel(b, size)
  return { x: (ap.x + bp.x) / 2, y: (ap.y + bp.y) / 2 }
}

export const edgeAt = (coord: AxialCoord, direction: number): EdgeId =>
  edgeIdOf(edgePairAt(coord, direction))

// The fixed multiset of number tokens each standard board ships with. Placement
// is random but the counts are not, which lets us recover a single token that a
// screenshot couldn't read (e.g. the robber sitting on top of it).
export const NUMBER_TOKEN_COUNTS: Record<LayoutId, Readonly<Record<number, number>>> = {
  standard4: { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 },
  extension6: { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 },
}

/**
 * When exactly one land hex is missing its number, deduce it from the standard
 * distribution: subtract every read token from the expected counts and, if the
 * remaining tokens collapse to a single value, that value must belong to the
 * lone gap. Returns null when the gap isn't unique or the read tokens are
 * inconsistent with the distribution (i.e. a non-standard board we shouldn't guess on).
 */
export function inferMissingNumberToken(
  hexes: readonly Hex[],
  layout: LayoutId,
): { coord: AxialCoord; number: number } | null {
  const missing = hexes.filter((hex) => hex.tile !== null && hex.tile !== 'desert' && hex.numberToken === null)
  if (missing.length !== 1) return null
  const remaining: Record<number, number> = { ...NUMBER_TOKEN_COUNTS[layout] }
  for (const hex of hexes) {
    if (hex.numberToken === null) continue
    if (!(hex.numberToken in remaining)) return null
    remaining[hex.numberToken] -= 1
    if (remaining[hex.numberToken] < 0) return null
  }
  const candidates = Object.entries(remaining).filter(([, count]) => count > 0)
  if (candidates.length !== 1 || candidates[0][1] !== 1) return null
  return { coord: missing[0].coord, number: Number(candidates[0][0]) }
}
