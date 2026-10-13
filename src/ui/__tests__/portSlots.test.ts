import { describe, expect, it } from 'vitest'
import { createBoard, removePort } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { newPortEdges } from '../placementSlots'

describe('newPortEdges', () => {
  const board = createBoard('standard4')

  it('has three open spots on a default standard board', () => {
    // Thirty coast edges, with each of the nine ports excluding itself and its two neighbours.
    expect(newPortEdges(board)).toHaveLength(3)
  })

  it('offers exactly the coast edges whose corners touch no port', () => {
    const taken = new Set(board.ports.flatMap((port) => edgeEndpointVertexIds(port.edgeId)))
    const open = newPortEdges(board)
    expect(open.length).toBeGreaterThan(0)
    expect(open).toEqual(boardGrid('standard4').coastalEdgeIds.filter((edgeId) =>
      edgeEndpointVertexIds(edgeId).every((vertexId) => !taken.has(vertexId))))
  })

  it('offers a deleted port\'s own edge again, and its neighbours only if no other port touches them', () => {
    const { edgeId } = board.ports[0]
    expect(newPortEdges(board)).not.toContain(edgeId)
    const without = removePort(board, edgeId)
    expect(newPortEdges(without)).toContain(edgeId)
    const taken = new Set(without.ports.flatMap((port) => edgeEndpointVertexIds(port.edgeId)))
    for (const open of newPortEdges(without)) expect(edgeEndpointVertexIds(open).some((vertexId) => taken.has(vertexId))).toBe(false)
  })
})
