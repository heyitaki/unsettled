import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board, type EdgeId, type VertexId } from '../../model/types'
import { inferDraftState, lastDraftPick, removeDraftPick, restoreDraftPick } from '../draft'

const grid = boardGrid('standard4')
// Far enough apart that no two share an edge, so a road touches one of them only.
const [v0, v1, v2, v3, v4] = [0, 10, 20, 30, 40].map((index) => grid.vertexIds[index])

const edgeAt = (vertexId: VertexId): EdgeId => {
  const edge = grid.edgeIds.find((edgeId) => edgeEndpointVertexIds(edgeId).includes(vertexId))
  if (!edge) throw new Error(`no edge at ${vertexId}`)
  return edge
}

function fourPlayers(): Board {
  let board = createBoard('standard4')
  board = addPlayer(board, { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: PLAYER_PALETTE.white })
  return addPlayer(board, { id: 'd', name: 'Dee', color: PLAYER_PALETTE.orange })
}

const settle = (board: Board, picks: readonly [string, VertexId][]): Board =>
  picks.reduce((next, [playerId, vertexId]) => placeBuilding(next, vertexId, playerId, 'settlement'), board)

describe('lastDraftPick', () => {
  it('finds nothing on a board with no settlement', () => {
    expect(lastDraftPick(fourPlayers())).toBeNull()
  })

  it('names the settlement the snake placed last, with no road when none touches it', () => {
    const board = settle(fourPlayers(), [['aki', v0], ['b', v1]])
    expect(lastDraftPick(board)).toEqual({ vertexId: v1, playerId: 'b', roads: [] })
  })

  it('carries only the picker\'s own roads that end at the settlement', () => {
    let board = settle(fourPlayers(), [['aki', v0], ['b', v1]])
    board = placeRoad(board, edgeAt(v0), 'aki')
    board = placeRoad(board, edgeAt(v1), 'b')
    expect(lastDraftPick(board)).toEqual({ vertexId: v1, playerId: 'b', roads: [edgeAt(v1)] })
  })

  it('follows the snake rather than board order, which an imported board does not keep', () => {
    // Bee's settlement stands first in `buildings`, yet the snake has Bee picking second.
    const board = settle(fourPlayers(), [['b', v1], ['aki', v0]])
    expect(lastDraftPick(board)).toMatchObject({ vertexId: v1, playerId: 'b' })
  })

  it('takes the later of a player\'s two settlements at the turn of the snake', () => {
    let board = settle(fourPlayers(), [['aki', v0], ['b', v1], ['c', v2], ['d', v3], ['d', v4]])
    board = placeRoad(board, edgeAt(v3), 'd')
    board = placeRoad(board, edgeAt(v4), 'd')
    expect(lastDraftPick(board)).toEqual({ vertexId: v4, playerId: 'd', roads: [edgeAt(v4)] })
  })

  it('falls back to the last settlement standing when the snake\'s picker has none', () => {
    // Two settlements, both Cee's: the snake expects aki then Bee, and neither has placed.
    const board = settle(fourPlayers(), [['c', v0], ['c', v1]])
    expect(lastDraftPick(board)).toMatchObject({ vertexId: v1, playerId: 'c' })
  })

  it('takes the settlement added last when a player has placed out of turn', () => {
    // The snake has Dee picking fifth, but the fifth settlement is Cee's second: Dee's only one stays.
    const board = settle(fourPlayers(), [['aki', v0], ['b', v1], ['c', v2], ['d', v3], ['c', v4]])
    expect(lastDraftPick(board)).toMatchObject({ vertexId: v4, playerId: 'c' })
  })

  it('does the same on a full board, where the draft no longer reports the mismatch', () => {
    // Eight settlements, but aki holds one and Dee three: the snake's last picker is aki.
    const owners = ['aki', 'b', 'b', 'c', 'c', 'd', 'd', 'd']
    const board = settle(fourPlayers(), owners.map((playerId, index) => [playerId, grid.vertexIds[index]]))
    expect(lastDraftPick(board)).toMatchObject({ vertexId: grid.vertexIds[7], playerId: 'd' })
  })

  it('leaves a board past its draft alone', () => {
    const drafted = settle(fourPlayers(), [['aki', v0], ['b', v1]])
    expect(lastDraftPick(placeBuilding(drafted, v0, 'aki', 'city'))).toBeNull()
    const overfilled = settle(fourPlayers(), grid.vertexIds.slice(0, 9).map((vertexId) => ['aki', vertexId]))
    expect(lastDraftPick(overfilled)).toBeNull()
  })
})

describe('removeDraftPick and restoreDraftPick', () => {
  const drafted = (): Board => {
    let board = settle(fourPlayers(), [['aki', v0], ['b', v1], ['c', v2]])
    board = placeRoad(board, edgeAt(v0), 'aki')
    return placeRoad(board, edgeAt(v2), 'c')
  }

  it('takes the settlement and its road off and hands the turn back', () => {
    const board = drafted()
    const pick = lastDraftPick(board)
    if (!pick) throw new Error('expected a pick')
    const back = removeDraftPick(board, pick)
    expect(back.buildings.map((building) => building.vertexId)).toEqual([v0, v1])
    expect(back.roads).toEqual([{ edgeId: edgeAt(v0), playerId: 'aki' }])
    expect(inferDraftState(back).currentPlayerId).toBe('c')
  })

  it('puts back exactly what it took', () => {
    const board = drafted()
    const pick = lastDraftPick(board)
    if (!pick) throw new Error('expected a pick')
    const again = restoreDraftPick(removeDraftPick(board, pick), pick)
    expect(again.buildings).toEqual(board.buildings)
    expect(again.roads).toEqual(board.roads)
  })

  it('steps all the way back to an empty draft', () => {
    let board = drafted()
    for (let step = 0; step < 3; step += 1) {
      const pick = lastDraftPick(board)
      if (!pick) throw new Error(`expected a pick at step ${step}`)
      board = removeDraftPick(board, pick)
    }
    expect(board.buildings).toEqual([])
    expect(board.roads).toEqual([])
    expect(lastDraftPick(board)).toBeNull()
  })
})
