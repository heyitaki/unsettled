import { describe, expect, it } from 'vitest'
import { analyzeBoardCached } from '../../engine/analyze'
import { addPlayer, createBoard, placeBuilding, randomizeBoard, setMe } from '../../model/board'
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

  it('predicts my picks from the top recommendation and the opponents before it from the rollout', () => {
    const board = randomizeBoard(fourPlayers())
    const analysis = analyzeBoardCached(board)
    expect(analysis.status).toBe('ready')
    const slots = draftSlots(board, analysis)
    const top = analysis.recommendations[0]
    // Cee picks third and sixth.
    expect(slots[2].vertex).toBe(top.firstPick)
    expect(slots[5].vertex).toBe(top.plannedSecond[0])
    // The two opponents ahead of me take the rollout's spots, in draft order.
    expect(analysis.takenBeforeFirstPick).toHaveLength(2)
    expect(slots[0].vertex).toBe(analysis.takenBeforeFirstPick[0].vertexId)
    expect(slots[1].vertex).toBe(analysis.takenBeforeFirstPick[1].vertexId)
    // Opponent picks after my first have no prediction.
    expect(slots.slice(3, 5).every((slot) => slot.vertex === undefined)).toBe(true)
    expect(slots.every((slot) => !slot.placed)).toBe(true)
  })

  it('still binds a settlement upgraded to a city once the draft is complete', () => {
    let board = randomizeBoard(fourPlayers())
    const order = analyzeBoardCached(board).draft.sequence
    // Play the whole snake out on vertices spaced well apart.
    const chosen = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0).slice(0, order.length)
    order.forEach((playerId, pick) => {
      board = placeBuilding(board, chosen[pick], playerId, 'settlement')
    })
    const upgraded = placeBuilding(board, chosen[0], order[0], 'city')
    const slots = slotsOf(upgraded)
    expect(slots.every((slot) => slot.placed)).toBe(true)
    expect(slots.map((slot) => slot.vertex)).toEqual(chosen)
  })
})
