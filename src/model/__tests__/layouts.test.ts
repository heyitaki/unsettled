import { describe, expect, it } from 'vitest'
import { edgeEndpointVertexIds } from '../coords'
import {
  PORT_EDGES_EXTENSION6,
  PORT_EDGES_STANDARD4,
  boardGrid,
} from '../layouts'

describe('board layouts', () => {
  it.each([
    ['standard4', 19, 54, 72, 30],
    ['extension6', 30, 80, 109, 38],
  ] as const)('%s has canonical topology', (layout, hexes, vertices, edges, coastal) => {
    const grid = boardGrid(layout)
    expect(grid.landCoords).toHaveLength(hexes)
    expect(grid.vertexIds).toHaveLength(vertices)
    expect(grid.edgeIds).toHaveLength(edges)
    expect(grid.coastalEdgeIds).toHaveLength(coastal)
  })

  it('pins corrected extension port slots', () => {
    expect(PORT_EDGES_EXTENSION6).toEqual([
      'e:0,-4;0,-3', 'e:-2,-2;-1,-2', 'e:2,-2;3,-2',
      'e:-3,-1;-3,0', 'e:2,0;3,-1', 'e:-4,1;-3,1',
      'e:1,1;2,1', 'e:-4,3;-3,2', 'e:-3,3;-3,4',
      'e:-2,4;-1,3', 'e:0,2;0,3',
    ])
  })

  it.each([
    ['standard4', PORT_EDGES_STANDARD4],
    ['extension6', PORT_EDGES_EXTENSION6],
  ] as const)('%s ports are distinct, coastal, and non-touching', (layout, ports) => {
    const coastal = new Set(boardGrid(layout).coastalEdgeIds)
    expect(new Set(ports).size).toBe(ports.length)
    expect(ports.every((edge) => coastal.has(edge))).toBe(true)
    expect(new Set(ports.flatMap(edgeEndpointVertexIds)).size).toBe(ports.length * 2)
  })
})
