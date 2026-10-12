import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setMe } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { setTile } from '../../model/__tests__/helpers'
import { RESOURCES, type Board } from '../../model/types'
import { analyzeBoard, setupRoad, type TakenVertex } from '../analyze'
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

// A pick is a settlement and the setup road that comes with it, so playing the line out lays both.
const playOut = (board: Board, taken: readonly TakenVertex[]): Board =>
  taken.reduce((next, { vertexId, playerId, road }) => {
    const settled = placeBuilding(next, vertexId, playerId, 'settlement')
    return road === null ? settled : placeRoad(settled, road, playerId)
  }, board)

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

/**
 * A pick is a settlement and its setup road, so the rollouts lay one with every pick they
 * simulate, and the line reports it beside the settlement. A lone setup road runs into its
 * owner's settlement, which already ends a walk, so it seldom moves a ranking: these tests pin
 * where the roads go and that the views agree, not that a road reorders a list.
 */
describe('the rollouts lay each simulated pick\'s setup road', () => {
  it.each(PATTERNS)('out of the picked corner, the road that picker\'s own list draws, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const predicted = analyzeBoard(setMe(board, 'p4'), options).takenBeforeFirstPick
    expect(predicted).toHaveLength(3)
    for (const [index, { vertexId, playerId, road }] of predicted.entries()) {
      // An open board always leaves a first settlement somewhere to expand to.
      expect(road, `pick ${index + 1}`).not.toBeNull()
      expect(edgeEndpointVertexIds(road!), `pick ${index + 1}`).toContain(vertexId)
      const own = analyzeBoard(setMe(playOut(board, predicted.slice(0, index)), playerId), options).recommendations[0]
      expect(road, `pick ${index + 1}`).toBe(own.firstRoad)
    }
  })

  it.each(PATTERNS)('and the ranking behind the line is the ranking once the line and its roads stand, board pattern %i', (pattern) => {
    // One rollout is the modal window alone, which is exactly the board the line leaves.
    const single = { rollouts: 1 }
    const board = setMe(fourSeatBoard(pattern), 'p3')
    const ahead = analyzeBoard(board, single)
    expect(ahead.takenBeforeFirstPick.map(({ playerId }) => playerId)).toEqual(['aki', 'p2'])
    const played = analyzeBoard(playOut(board, ahead.takenBeforeFirstPick), single)
    expect(ahead.recommendations).toEqual(played.recommendations)
  })

  it.each(PATTERNS)('and a seat picking twice in a row plans each second pick on the board its first pick and road leave, board pattern %i', (pattern) => {
    // One rollout and no pick in between, so each plan is read off exactly that board.
    const single = { rollouts: 1, maxResults: 54 }
    const opening = analyzeBoard(setMe(fourSeatBoard(pattern), 'p4'), single).takenBeforeFirstPick
    const board = setMe(playOut(fourSeatBoard(pattern), opening), 'p4')
    const plans = analyzeBoard(board, single).recommendations
    expect(plans.length).toBeGreaterThan(10)
    for (const plan of plans) {
      const first: TakenVertex = { vertexId: plan.firstPick, playerId: 'p4', road: plan.firstRoad, frequency: 1 }
      const [second] = analyzeBoard(playOut(board, [first]), single).recommendations
      expect(plan.plannedSecond[0], plan.firstPick).toBe(second.firstPick)
      expect(plan.secondRoad, plan.firstPick).toBe(second.firstRoad)
    }
  })

  it.each(PATTERNS)('and a corner placed by hand gets the road its row draws, board pattern %i', (pattern) => {
    const board = fourSeatBoard(pattern)
    const rows = analyzeBoard(setMe(board, 'aki'), options).recommendations
    expect(rows.length).toBeGreaterThan(0)
    for (const { firstPick, firstRoad } of rows) expect(setupRoad(board, 'aki', firstPick)).toBe(firstRoad)
    // With no number tokens every site is worth nothing, and a road picked by tie-break is noise.
    expect(setupRoad(createBoard('standard4'), 'aki', rows[0].firstPick)).toBeNull()
  })

  it.each(PATTERNS)('and my planned second settlement carries its own road, board pattern %i', (pattern) => {
    const { recommendations } = analyzeBoard(setMe(fourSeatBoard(pattern), 'aki'), options)
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.some(({ secondRoad }) => secondRoad !== null)).toBe(true)
    for (const { plannedSecond, secondRoad } of recommendations) {
      if (secondRoad !== null) expect(edgeEndpointVertexIds(secondRoad)).toContain(plannedSecond[0])
    }
  })

  it.each(PATTERNS)('and the second pick a row draws is one the likely-gone line leaves standing, board pattern %i', (pattern) => {
    // The row's marks and the line are drawn together, so they are read off the same rollout:
    // the most common plan across all of them can be a corner the line gives a rival.
    const { recommendations, takenBeforeFirstPick } = analyzeBoard(setMe(fourSeatBoard(pattern), 'p4'))
    const gone = blockedVertices('standard4', takenBeforeFirstPick.map(({ vertexId }) => vertexId))
    const lineRoads = takenBeforeFirstPick.map(({ road }) => road)
    for (const { firstPick, plannedSecond, secondRoad } of recommendations) {
      if (gone.has(firstPick)) continue
      expect(gone.has(plannedSecond[0]), firstPick).toBe(false)
      if (secondRoad !== null) expect(lineRoads, firstPick).not.toContain(secondRoad)
    }
  })
})
