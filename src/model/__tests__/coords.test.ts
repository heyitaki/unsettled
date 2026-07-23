import { describe, expect, it } from 'vitest'
import {
  edgeEndpointVertexIds,
  edgeIdOf,
  edgePairAt,
  hexEdgeIds,
  hexVertexIds,
  parseEdgeId,
  parseVertexId,
  vertexAdjacentVertexIds,
  vertexIdOf,
  vertexIncidentEdgeIds,
  vertexTouchingHexes,
  vertexTripleAt,
} from '../coords'

describe('canonical board coordinates', () => {
  it('keeps phantom sea coordinates in canonical IDs', () => {
    const coord = { q: -3, r: 2 }
    expect(vertexIdOf(vertexTripleAt(coord, 2))).toMatch(/^v:(-?\d+,-?\d+;){2}-?\d+,-?\d+$/)
    expect(edgeIdOf(edgePairAt(coord, 3))).toMatch(/^e:-?\d+,-?\d+;-?\d+,-?\d+$/)
  })

  it('round-trips IDs and derives adjacency', () => {
    const vertex = 'v:0,0;1,-1;1,0' as const
    const edge = 'e:0,0;1,0' as const
    expect(vertexIdOf(parseVertexId(vertex))).toBe(vertex)
    expect(edgeIdOf(parseEdgeId(edge))).toBe(edge)
    expect(edgeEndpointVertexIds(edge)).toHaveLength(2)
    expect(vertexIncidentEdgeIds(vertex)).toHaveLength(3)
    expect(vertexAdjacentVertexIds(vertex)).toHaveLength(3)
    expect(vertexTouchingHexes(vertex)).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: -1 },
      { q: 1, r: 0 },
    ])
    expect(hexVertexIds({ q: 0, r: 0 })).toHaveLength(6)
    expect(hexEdgeIds({ q: 0, r: 0 })).toHaveLength(6)
  })

  it('rejects malformed IDs', () => {
    expect(() => parseVertexId('v:0,0;1,0' as never)).toThrow()
    expect(() => parseEdgeId('edge:0,0;1,0' as never)).toThrow()
  })
})
