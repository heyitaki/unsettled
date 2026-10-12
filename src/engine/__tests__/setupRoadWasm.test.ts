import { expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { setTile } from '../../model/__tests__/helpers'
import { RESOURCES, type VertexId } from '../../model/types'
import { analyze, setupRoad } from './analyzeWasm'

it('returns the ranked setup road through the wasm export, including existing roads and unknown players', () => {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' })
  for (const [index, hex] of board.hexes.entries()) board = setTile(board, hex.coord, RESOURCES[index % RESOURCES.length], 6)
  board = placeRoad(board, boardGrid(board.layout).edgeIds[0], 'b')
  const rows = analyze(board, { rollouts: 1 }).recommendations
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(setupRoad(board, 'aki', row.firstPick)).toBe(row.firstRoad)
    const road = setupRoad(board, 'nobody', row.firstPick)
    expect(road).not.toBeNull()
    expect(edgeEndpointVertexIds(road!)).toContain(row.firstPick)
  }
  const vertexId = rows[0].firstPick
  expect(setupRoad(createBoard('standard4'), 'aki', vertexId)).toBeNull()
  expect(setupRoad(board, 'aki', 'v:999,999;999,998;998,999' as VertexId)).toBeNull()
  expect(setupRoad(placeBuilding(board, vertexId, 'aki', 'settlement'), 'aki', vertexId)).toBeNull()
  expect(setupRoad(board, 'aki', vertexId)).toBe(rows[0].firstRoad)
})
