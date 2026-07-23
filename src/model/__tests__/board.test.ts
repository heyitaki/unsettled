import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  draftOrder,
  pips,
  placeBuilding,
  placeRoad,
  removePlayer,
  setLayout,
  setTile,
  validateBoard,
  vertexProduction,
} from '../board'
import { boardGrid } from '../layouts'

describe('board operations', () => {
  it('creates both blank layouts with default ports', () => {
    expect(createBoard('standard4').hexes).toHaveLength(19)
    expect(createBoard('extension6').ports).toHaveLength(11)
  })

  it('derives snake order and production', () => {
    let board = createBoard('standard4')
    board = addPlayer(board, { id: 'b', name: 'Bee', color: '#3063ba' })
    expect(draftOrder(board)).toEqual(['aki', 'b', 'b', 'aki'])
    const vertexId = boardGrid('standard4').vertexIds.find((id) =>
      id.includes('0,0'),
    )!
    board = setTile(board, { q: 0, r: 0 }, 'wood', 6)
    expect(vertexProduction(board, vertexId).wood).toBe(5)
    expect(pips(8)).toBe(5)
  })

  it('replaces occupants and strips a removed player pieces', () => {
    let board = addPlayer(createBoard('standard4'), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    board = placeRoad(board, boardGrid('standard4').edgeIds[0], 'b')
    board = placeBuilding(board, boardGrid('standard4').vertexIds[0], 'b', 'city')
    board = removePlayer(board, 'b')
    expect(board.roads).toEqual([])
    expect(board.buildings).toEqual([])
  })

  it('keeps roster when changing layout', () => {
    const board = addPlayer(createBoard('standard4'), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    expect(setLayout(board, 'extension6').players).toEqual(board.players)
  })

  it('reports schema and placement errors without throwing', () => {
    const board = createBoard('standard4')
    const broken = {
      ...board,
      schemaVersion: 2,
      ports: [...board.ports, board.ports[0]],
    } as never
    expect(validateBoard(broken).filter((issue) => issue.severity === 'error')).not.toHaveLength(0)
  })
})
