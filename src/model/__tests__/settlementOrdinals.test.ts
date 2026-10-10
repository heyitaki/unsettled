import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, removeBuilding, settlementOrdinals } from '../board'
import { boardGrid } from '../layouts'

describe('settlementOrdinals', () => {
  const [a, b, c, d] = boardGrid('standard4').vertexIds.filter((_vertexId, index) => index % 9 === 0)
  const seeded = () => {
    let board = createBoard('standard4')
    board = { ...board, players: [], mePlayerId: null }
    board = addPlayer(board, { id: 'p1', name: 'White', color: '#ffffff' })
    return addPlayer(board, { id: 'p2', name: 'Brown', color: '#684d43' })
  }

  it('numbers each player\'s settlements in the order they were placed', () => {
    let board = seeded()
    board = placeBuilding(board, a, 'p1', 'settlement')
    board = placeBuilding(board, b, 'p2', 'settlement')
    board = placeBuilding(board, c, 'p2', 'settlement')
    board = placeBuilding(board, d, 'p1', 'settlement')
    expect(settlementOrdinals(board)).toEqual(new Map([[a, 1], [b, 1], [c, 2], [d, 2]]))
  })

  it('renumbers after the first settlement is removed', () => {
    let board = seeded()
    board = placeBuilding(board, a, 'p1', 'settlement')
    board = placeBuilding(board, d, 'p1', 'settlement')
    board = removeBuilding(board, a)
    expect(settlementOrdinals(board)).toEqual(new Map([[d, 1]]))
  })
})
