import { describe, expect, it } from 'vitest'
import { analyzeBoardCached } from '../../engine/analyze'
import { createBoard, randomizeBoard, setMe } from '../../model/board'
import { restingMarks, SOLID_RANKS } from '../restMarks'

describe('restingMarks', () => {
  it('marks nothing while nobody is claimed or the board is not ready', () => {
    const blank = createBoard('standard4')
    expect(restingMarks(blank, analyzeBoardCached(blank))).toBeNull()
    const unclaimed = setMe(randomizeBoard(blank), null)
    expect(restingMarks(unclaimed, analyzeBoardCached(unclaimed))).toBeNull()
  })

  it('marks every listed pick in my colour, ranked, with the lower ranks faded', () => {
    const board = randomizeBoard(createBoard('standard4'))
    const analysis = analyzeBoardCached(board)
    const marks = restingMarks(board, analysis)
    expect(marks).not.toBeNull()
    const me = board.players.find((player) => player.id === board.mePlayerId)
    expect(marks!.map((mark) => mark.ref)).toEqual(analysis.recommendations.slice(0, 5).map((pick) => pick.firstPick))
    expect(marks!.map((mark) => mark.label)).toEqual(['1', '2', '3', '4', '5'])
    expect(marks!.every((mark) => mark.color === me?.color)).toBe(true)
    expect(marks!.map((mark) => mark.faded)).toEqual(marks!.map((_, index) => index >= SOLID_RANKS))
  })
})
