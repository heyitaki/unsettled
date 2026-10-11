import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { RESOURCES, type Board } from '../../model/types'
import { analyzeBoard, type TakenVertex } from '../analyze'
import { blockedVertices } from '../legality'
import { DEFAULT_WEIGHTS } from '../weights'

const tokens = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12] as const
const PATTERNS = [0, 1, 2, 3, 4, 5] as const
// Few rollouts keep the file quick. The promise under test does not depend on the count, only on
// both views being handed the same options.
const options = { rollouts: 4 }

function fourSeatBoard(pattern: number): Board {
  let board = createBoard('standard4')
  for (const id of ['p2', 'p3', 'p4']) board = addPlayer(board, { id, name: id, color: '#333333' })
  for (let index = 0; index < board.hexes.length; index += 1) {
    const resource = RESOURCES[(index * 3 + pattern * 7 + Math.floor(index / 3)) % RESOURCES.length]
    const token = tokens[(index * 7 + pattern * 3) % tokens.length]
    board = setTile(board, board.hexes[index].coord, resource, token)
  }
  return board
}

const topPick = (board: Board, playerId: string) =>
  analyzeBoard(setMe(board, playerId), options).recommendations[0]?.firstPick

const playOut = (board: Board, taken: readonly TakenVertex[]): Board =>
  taken.reduce((next, { vertexId, playerId }) => placeBuilding(next, vertexId, playerId, 'settlement'), board)

/**
 * "Likely gone before your turn" names the spot each rival ahead of me is expected to take. The
 * panel shows that same rival its own ranked list when I switch to it, so the two have to name the
 * same spot: a prediction the rival's own list disagrees with is one the app does not believe.
 */
describe('likely-gone picks match the picker\'s own top recommendation', () => {
  it.each(PATTERNS)('for the seat on the clock, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const predicted = analyzeBoard(setMe(board, 'p2'), options).takenBeforeFirstPick
    expect(predicted).toHaveLength(1)
    expect(predicted[0]).toMatchObject({ playerId: 'aki', vertexId: topPick(board, 'aki') })
  })

  it.each(PATTERNS)('for every pick of the line, each on the board the earlier ones leave, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const predicted = analyzeBoard(setMe(board, 'p4'), options).takenBeforeFirstPick
    expect(predicted.map(({ playerId }) => playerId)).toEqual(['aki', 'p2', 'p3'])
    for (const [index, { vertexId, playerId }] of predicted.entries()) {
      expect(vertexId, `pick ${index + 1}`).toBe(topPick(playOut(board, predicted.slice(0, index)), playerId))
    }
  })

  it.each(PATTERNS)('for a seat picking twice in a row, which keeps the order of its pair, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const opening = analyzeBoard(setMe(board, 'p4'), options).takenBeforeFirstPick
    const played = playOut(board, opening)
    const predicted = analyzeBoard(setMe(played, 'aki'), options).takenBeforeFirstPick
    expect(predicted[0]).toMatchObject({ playerId: 'p4', vertexId: topPick(played, 'p4') })
  })
})

/**
 * The line and the availability beside each of my picks come from the same rollouts. Were the
 * sampled ones to draw a rival from some other ranking than the line's, a spot could read as
 * likely gone and as my safest pick at once.
 */
describe('the rollouts behind my picks draw a rival from that rival\'s own list', () => {
  it.each(PATTERNS)('so a pick only loses availability to a spot on that list, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const sampled = { rollouts: 12 }
    const rivalList = analyzeBoard(setMe(board, 'aki'), { ...sampled, maxResults: DEFAULT_WEIGHTS.opponentTopK })
      .recommendations.map(({ firstPick }) => firstPick)
    const reach = blockedVertices(board.layout, rivalList)
    const mine = analyzeBoard(setMe(board, 'p2'), { ...sampled, maxResults: 54 }).recommendations
    const contested = mine.filter(({ survival }) => survival < 1).map(({ firstPick }) => firstPick)
    expect(contested.filter((vertexId) => !reach.has(vertexId))).toEqual([])
  })
})
