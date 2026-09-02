import { describe, expect, it } from 'vitest'
import { analyzeBoardCached } from '../../engine/analyze'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { draftSlots } from '../draftSlots'

const slotsOf = (board: Board) => draftSlots(board, analyzeBoardCached(board))

function fourPlayers(): Board {
  let board = createBoard('standard4')
  board = addPlayer(board, { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: PLAYER_PALETTE.white })
  board = addPlayer(board, { id: 'd', name: 'Dee', color: PLAYER_PALETTE.orange })
  return setMe(board, 'c')
}

describe('draftSlots', () => {
  it('reads a blank board as eight unplaced picks with the first one current', () => {
    const slots = slotsOf(fourPlayers())
    expect(slots).toHaveLength(8)
    expect(slots.every((slot) => !slot.placed && slot.vertex === undefined)).toBe(true)
    expect(slots.map((slot) => slot.current)).toEqual([true, false, false, false, false, false, false, false])
  })

  it('marks exactly the claimed player\'s two snake picks as mine', () => {
    const slots = slotsOf(fourPlayers())
    expect(slots.flatMap((slot, index) => slot.mine ? [index] : [])).toEqual([2, 5])
    expect(slots[2].playerId).toBe('c')
    expect(slots[5].playerId).toBe('c')
  })

  it('binds a placed settlement to its pick and moves the current pick on', () => {
    const board = fourPlayers()
    const vertex = boardGrid('standard4').vertexIds[0]
    const slots = slotsOf(placeBuilding(board, vertex, 'aki', 'settlement'))
    expect(slots[0]).toMatchObject({ playerId: 'aki', placed: true, vertex, current: false })
    expect(slots[1]).toMatchObject({ placed: false, current: true })
    expect(slots.filter((slot) => slot.placed)).toHaveLength(1)
  })
})
