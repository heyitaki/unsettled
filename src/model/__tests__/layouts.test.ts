import { describe, expect, it } from 'vitest'
import { edgeEndpointVertexIds } from '../coords'
import {
  NUMBER_TOKEN_COUNTS,
  PORT_EDGES_EXTENSION6,
  PORT_EDGES_STANDARD4,
  boardGrid,
  inferMissingNumberToken,
} from '../layouts'
import type { Hex, LayoutId } from '../types'

// A full standard token set laid onto arbitrary coords plus a desert, for
// exercising the distribution-based inference in isolation.
function fullTokenHexes(layout: LayoutId): Hex[] {
  const hexes: Hex[] = []
  let q = 0
  for (const [number, count] of Object.entries(NUMBER_TOKEN_COUNTS[layout])) {
    for (let i = 0; i < count; i += 1) {
      hexes.push({ coord: { q: q++, r: 0 }, tile: 'wood', numberToken: Number(number) })
    }
  }
  hexes.push({ coord: { q: q++, r: 0 }, tile: 'desert', numberToken: null })
  return hexes
}

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

describe('missing number inference', () => {
  it.each(['standard4', 'extension6'] as const)('recovers the single occluded token on %s', (layout) => {
    const hexes = fullTokenHexes(layout)
    const target = hexes.find((hex) => hex.numberToken === 6)!
    target.numberToken = null
    expect(inferMissingNumberToken(hexes, layout)).toEqual({ coord: target.coord, number: 6 })
  })

  it('does not infer when two tokens are missing', () => {
    const hexes = fullTokenHexes('standard4')
    hexes.filter((hex) => hex.numberToken === 8).forEach((hex) => { hex.numberToken = null })
    expect(inferMissingNumberToken(hexes, 'standard4')).toBeNull()
  })

  it('does not infer on a board whose read tokens break the standard distribution', () => {
    const hexes = fullTokenHexes('standard4')
    // Two gaps but an extra 5 elsewhere — read counts no longer match, so the
    // lone-gap deduction is not trustworthy.
    const gaps = hexes.filter((hex) => hex.numberToken === 9)
    gaps[0].numberToken = null
    gaps[1].numberToken = 5
    expect(inferMissingNumberToken(hexes, 'standard4')).toBeNull()
  })

  it('ignores the desert and returns null when nothing is missing', () => {
    expect(inferMissingNumberToken(fullTokenHexes('extension6'), 'extension6')).toBeNull()
  })
})
