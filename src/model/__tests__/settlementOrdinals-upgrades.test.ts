import { describe, expect, it } from 'vitest'
import { createBoard, placeBuilding, settlementOrdinals } from '../board'
import { boardGrid } from '../layouts'

describe('settlement ordinal limits and upgrades', () => {
  const [a, b, c] = boardGrid('standard4').vertexIds

  it('retains the second pick ordinal after the first settlement is upgraded', () => {
    let board = createBoard('standard4')
    const player = board.players[0].id
    board = placeBuilding(board, a, player, 'settlement')
    board = placeBuilding(board, b, player, 'settlement')
    board = placeBuilding(board, a, player, 'city')
    expect(settlementOrdinals(board)).toEqual(new Map([[b, 2]]))
  })

  it('does not assign an ordinal to a third settlement', () => {
    let board = createBoard('standard4')
    for (const vertex of [a, b, c]) board = placeBuilding(board, vertex, board.players[0].id, 'settlement')
    expect(settlementOrdinals(board)).toEqual(new Map([[a, 1], [b, 2]]))
  })
})
