import { describe, expect, it } from 'vitest'
import { createBoard, placeBuilding } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import {
  blockedVertices,
  blockVertex,
  legalSettlementVertices,
  vertexAdjacency,
} from '../legality'

describe('settlement legality', () => {
  it('starts with every grid vertex legal', () => {
    expect(legalSettlementVertices(createBoard('standard4'))).toHaveLength(54)
    expect(legalSettlementVertices(createBoard('extension6'))).toHaveLength(80)
  })

  it('blocks an occupied vertex and its in-grid neighbors for every building tier', () => {
    const base = createBoard('standard4')
    const adjacency = vertexAdjacency(base.layout)
    const vertexId = boardGrid(base.layout).vertexIds.find((id) => adjacency.get(id)?.length === 3)!
    const expectedRemoved = new Set([vertexId, ...(adjacency.get(vertexId) ?? [])])
    for (const tier of ['settlement', 'city'] as const) {
      const board = placeBuilding(base, vertexId, 'aki', tier)
      const legal = new Set(legalSettlementVertices(board))
      expect([...expectedRemoved].every((id) => !legal.has(id))).toBe(true)
      expect(legal.size).toBe(54 - expectedRemoved.size)
    }
  })

  it('keeps incremental and from-scratch distance closures equal', () => {
    const board = createBoard('standard4')
    const [first, second] = boardGrid(board.layout).vertexIds
    const incremental = blockedVertices(board.layout, [first])
    blockVertex(vertexAdjacency(board.layout), incremental, second)
    expect(incremental).toEqual(blockedVertices(board.layout, [first, second]))
    expect(legalSettlementVertices(board, [first, second])).toEqual(
      boardGrid(board.layout).vertexIds.filter((vertexId) => !incremental.has(vertexId)),
    )
  })
})
