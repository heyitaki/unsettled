import { describe, expect, it } from 'vitest'
import { inferDraftState } from '../../engine/draft'
import { addPlayer, createBoard, placeBuilding, randomizeBoard, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { draftSlots } from '../draftSlots'

const slotsOf = (board: Board) => draftSlots(board, inferDraftState(board))

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
    expect(slots.every((slot) => !slot.placed)).toBe(true)
    expect(slots.map((slot) => slot.current)).toEqual([true, false, false, false, false, false, false, false])
  })

  it('marks exactly the claimed player\'s two snake picks as mine', () => {
    const slots = slotsOf(fourPlayers())
    expect(slots.flatMap((slot, index) => slot.mine ? [index] : [])).toEqual([2, 5])
    expect(slots[2].playerId).toBe('c')
    expect(slots[5].playerId).toBe('c')
  })

  it('views the claimed player\'s next unplaced pick, wherever the turn is', () => {
    const viewed = (board: Board) => slotsOf(board).flatMap((slot, index) => slot.viewed ? [index] : [])
    const spaced = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0)
    let board = fourPlayers()
    // The turn is the first seat's, yet the cards rank the claimed third seat's pick.
    expect(viewed(board)).toEqual([2])
    expect(viewed(setMe(board, 'd'))).toEqual([3])
    ;['aki', 'b', 'c'].forEach((playerId, pick) => {
      board = placeBuilding(board, spaced[pick], playerId, 'settlement')
    })
    expect(viewed(board)).toEqual([5])
    expect(viewed({ ...board, mePlayerId: null })).toEqual([])
  })

  it('views exactly the slot it is handed, in place of the default', () => {
    const board = fourPlayers()
    const viewed = (slot: number | null) =>
      draftSlots(board, inferDraftState(board), slot).flatMap((entry, index) => entry.viewed ? [index] : [])
    expect(viewed(5)).toEqual([5])
    expect(viewed(null)).toEqual([2])
  })

  it('binds a placed settlement to its pick and moves the current pick on', () => {
    const board = fourPlayers()
    const vertex = boardGrid('standard4').vertexIds[0]
    const slots = slotsOf(placeBuilding(board, vertex, 'aki', 'settlement'))
    expect(slots[0]).toMatchObject({ playerId: 'aki', placed: true, current: false })
    expect(slots[1]).toMatchObject({ placed: false, current: true })
    expect(slots.filter((slot) => slot.placed)).toHaveLength(1)
  })

  it('still binds a settlement upgraded to a city once the draft is complete', () => {
    let board = randomizeBoard(fourPlayers())
    const order = inferDraftState(board).sequence
    // Play the whole snake out on vertices spaced well apart.
    const chosen = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0).slice(0, order.length)
    order.forEach((playerId, pick) => {
      board = placeBuilding(board, chosen[pick], playerId, 'settlement')
    })
    const upgraded = placeBuilding(board, chosen[0], order[0], 'city')
    const slots = slotsOf(upgraded)
    expect(slots.every((slot) => slot.placed)).toBe(true)
  })
})
