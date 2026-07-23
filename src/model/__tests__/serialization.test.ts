import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  placeBuilding,
  placeRoad,
  setRobber,
  setTile,
  upsertPort,
} from '../board'
import { boardGrid } from '../layouts'
import { parseBoard, serializeBoard } from '../serialization'

describe('board serialization', () => {
  it.each(['standard4', 'extension6'] as const)('round trips a populated %s board', (layout) => {
    let board = addPlayer(createBoard(layout), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    const resources = ['wood', 'sheep', 'wheat', 'brick', 'ore'] as const
    const numbers = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
    for (const [index, hex] of board.hexes.entries()) {
      board = index === board.hexes.length - 1
        ? setTile(board, hex.coord, 'desert')
        : setTile(board, hex.coord, resources[index % resources.length], numbers[index % numbers.length])
    }
    board = upsertPort(board, board.ports[0].edgeId, 'wood', 2)
    board = upsertPort(board, board.ports[1].edgeId, null, 5)
    board = setRobber(board, board.hexes.at(-1)!.coord)
    board = placeRoad(board, boardGrid(layout).edgeIds[0], 'b')
    board = placeRoad(board, boardGrid(layout).edgeIds[1], 'aki')
    board = placeBuilding(board, boardGrid(layout).vertexIds[0], 'aki', 'superCity')
    board = placeBuilding(board, boardGrid(layout).vertexIds[1], 'b', 'city')
    expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board })
  })

  it('rejects future schemas, extra keys, malformed JSON, and invalid locations', () => {
    const board = createBoard('standard4')
    expect(parseBoard('{')).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, schemaVersion: 2 })).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, surprise: true })).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, roads: [{ edgeId: 'e:99,99;100,99', playerId: 'aki' }] })).toMatchObject({ ok: false })
  })
})
