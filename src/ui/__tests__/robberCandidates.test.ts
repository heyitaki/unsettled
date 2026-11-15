import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding } from '../../model/board'
import { hexVertexIds } from '../../model/coords'
import { adjustHand, newGame } from '../../model/game'
import { robberCandidates } from '../bestMoves'

describe('robberCandidates', () => {
  const hex = { q: 0, r: 0 }
  const corners = hexVertexIds(hex)
  const board = addPlayer(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }),
    { id: 'c', name: 'Cee', color: '#fff' })

  it('has no victims without buildings', () => {
    expect(robberCandidates(adjustHand(newGame(board), 'b', 'wood', 1), hex, 'aki')).toEqual([])
  })

  it('excludes the mover', () => {
    const game = adjustHand(newGame(placeBuilding(board, corners[0], 'aki', 'settlement')), 'aki', 'wood', 1)
    expect(robberCandidates(game, hex, 'aki')).toEqual([])
  })

  it('excludes a victim with no cards', () => {
    expect(robberCandidates(newGame(placeBuilding(board, corners[0], 'b', 'city')), hex, 'aki')).toEqual([])
  })

  it('excludes a building on a neighbouring hex outside the tapped corners', () => {
    const corner = hexVertexIds({ q: 0, r: 1 }).find((vertex) => !corners.includes(vertex))!
    const game = adjustHand(newGame(placeBuilding(board, corner, 'b', 'settlement')), 'b', 'wood', 1)
    expect(robberCandidates(game, hex, 'aki')).toEqual([])
  })

  it('returns victims once in seat order, including cities and unknown cards', () => {
    let pieces = placeBuilding(board, corners[0], 'c', 'city')
    pieces = placeBuilding(pieces, corners[2], 'b', 'settlement')
    pieces = placeBuilding(pieces, corners[4], 'b', 'city')
    const game = adjustHand(newGame(pieces), 'c', 'wood', 1)
    game.stats.b = { ...game.stats.b, handUnknown: 1 }
    expect(robberCandidates(game, hex, 'aki')).toEqual(['b', 'c'])
  })
})
