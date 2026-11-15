import { describe, expect, it } from 'vitest'
import { clearPieces, createBoard, placeBuilding, placeRoad, randomizeBoard, setRobber } from '../board'
import { vertexIncidentEdgeIds } from '../coords'
import { boardGrid } from '../layouts'

describe('clearPieces', () => {
  const dealt = randomizeBoard(createBoard('standard4'))
  const player = dealt.players[0].id
  const vertex = boardGrid('standard4').vertexIds[0]

  it('removes every building and road and leaves the map, robber and players', () => {
    const robbed = setRobber(dealt, dealt.hexes[3].coord)
    const built = placeRoad(placeBuilding(robbed, vertex, player, 'settlement'), vertexIncidentEdgeIds(vertex)[0], player)
    const cleared = clearPieces(built)
    expect(cleared.buildings).toEqual([])
    expect(cleared.roads).toEqual([])
    expect(cleared.hexes).toBe(built.hexes)
    expect(cleared.ports).toBe(built.ports)
    expect(cleared.robber).toEqual(built.robber)
    expect(cleared.players).toBe(built.players)
    expect(cleared.mePlayerId).toBe(built.mePlayerId)
  })

  it('returns the same board when there is nothing to remove', () => {
    expect(clearPieces(dealt)).toBe(dealt)
  })
})
