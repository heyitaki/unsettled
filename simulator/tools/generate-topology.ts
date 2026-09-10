import {
  axialKey,
  edgeEndpointVertexIds,
  hexEdgeIds,
  hexVertexIds,
  neighbor,
  vertexAdjacentVertexIds,
  vertexIncidentEdgeIds,
  parseVertexId,
} from '../../src/model/coords.ts'
import {
  boardGrid,
  defaultPortEdges,
  NUMBER_TOKEN_COUNTS,
} from '../../src/model/layouts.ts'
import type { LayoutId, TileKind } from '../../src/model/types.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Mirrors the physical-box constant RESOURCE_COUNTS in src/model/board.ts.
const RESOURCE_COUNTS: Record<LayoutId, Record<TileKind, number>> = {
  standard4: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
  extension6: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'topology')

for (const layout of ['standard4', 'extension6'] as const) {
  const grid = boardGrid(layout)
  const landIndex = new Map(grid.landCoords.map((coord, index) => [axialKey(coord), index]))
  const vertexSet = new Set(grid.vertexIds)
  const edgeSet = new Set(grid.edgeIds)
  const pack = {
    layout,
    hexCount: grid.landCoords.length,
    vertexCount: grid.vertexIds.length,
    edgeCount: grid.edgeIds.length,
    hexKeys: grid.landCoords.map(axialKey),
    vertexIds: grid.vertexIds,
    edgeIds: grid.edgeIds,
    hexVertices: grid.landCoords.map((coord) => hexVertexIds(coord)),
    hexEdges: grid.landCoords.map((coord) => hexEdgeIds(coord)),
    hexNeighbors: grid.landCoords.map((coord) =>
      Array.from({ length: 6 }, (_, direction) => landIndex.get(axialKey(neighbor(coord, direction))))
        .filter((index): index is number => index !== undefined),
    ),
    vertexHexes: grid.vertexIds.map((id) =>
      parseVertexId(id).map(axialKey).filter((key) => landIndex.has(key)),
    ),
    vertexEdges: grid.vertexIds.map((id) =>
      vertexIncidentEdgeIds(id).filter((edge) => edgeSet.has(edge)),
    ),
    vertexAdjacent: grid.vertexIds.map((id) =>
      vertexAdjacentVertexIds(id).filter((vertex) => vertexSet.has(vertex)),
    ),
    edgeEndpoints: grid.edgeIds.map((id) =>
      edgeEndpointVertexIds(id).filter((vertex) => vertexSet.has(vertex)),
    ),
    coastalEdges: grid.coastalEdgeIds,
    defaultPortEdges: defaultPortEdges(layout),
    resourceCounts: RESOURCE_COUNTS[layout],
    tokenCounts: NUMBER_TOKEN_COUNTS[layout],
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, `${layout}.json`), `${JSON.stringify(pack, null, 2)}\n`)
}
