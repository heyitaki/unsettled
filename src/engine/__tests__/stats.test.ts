import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds, hexEdgeIds, vertexTripleAt } from '../../model/coords'
import { adjustCounter, newGame, withBoard, type Game } from '../../model/game'
import type { Board, EdgeId, VertexId } from '../../model/types'
import { computeStandings, longestRoadLength, SUPER_CITY_VP } from '../stats'

// Edges around the center hex form a 6-cycle; edge d and edge d+1 share one
// vertex, so consecutive slices are connected chains.
const ring = hexEdgeIds({ q: 0, r: 0 })
// A ring two hexes out: shares no edge with `ring`, so two players can build
// five each without overwriting one another.
const outerRing = hexEdgeIds({ q: 2, r: -2 })

const sharedVertex = (a: EdgeId, b: EdgeId): VertexId => {
  const other = new Set(edgeEndpointVertexIds(b))
  const vertex = edgeEndpointVertexIds(a).find((id) => other.has(id))
  if (!vertex) throw new Error('Edges do not touch')
  return vertex
}

function twoPlayerBoard(): Board {
  return addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
}

const roads = (board: Board, playerId: string, edges: EdgeId[]): Board =>
  edges.reduce((acc, edge) => placeRoad(acc, edge, playerId), board)

const standingFor = (game: Game, playerId: string) => {
  const standing = computeStandings(game).find((entry) => entry.playerId === playerId)
  if (!standing) throw new Error(`No standing for ${playerId}`)
  return standing
}

describe('longestRoadLength', () => {
  it('returns 0 with no roads and 1 for a single road', () => {
    const board = twoPlayerBoard()
    expect(longestRoadLength(board, 'aki')).toBe(0)
    expect(longestRoadLength(roads(board, 'aki', [ring[0]]), 'aki')).toBe(1)
  })

  it('measures a linear chain and ignores other players\' roads', () => {
    let board = roads(twoPlayerBoard(), 'aki', [ring[0], ring[1], ring[2]])
    board = roads(board, 'b', [ring[3], ring[4]])
    expect(longestRoadLength(board, 'aki')).toBe(3)
    expect(longestRoadLength(board, 'b')).toBe(2)
  })

  it('takes the longest arm-to-arm path through a branch', () => {
    // A fork: chain 0-1-2 plus a road of the adjacent hex hanging off the
    // 0/1 junction. Longest trail spans fork arm + the two-edge arm = 3.
    const junction = sharedVertex(ring[0], ring[1])
    const spur = hexEdgeIds({ q: 1, r: 0 }).find(
      (edge) => edge !== ring[0] && edgeEndpointVertexIds(edge).includes(junction),
    )
    if (!spur) throw new Error('No spur edge found')
    const board = roads(twoPlayerBoard(), 'aki', [ring[0], ring[1], ring[2], spur])
    expect(longestRoadLength(board, 'aki')).toBe(3)
  })

  it('traverses a full loop once', () => {
    const board = roads(twoPlayerBoard(), 'aki', ring)
    expect(longestRoadLength(board, 'aki')).toBe(6)
  })

  it('is broken by an opponent building but not by an own building', () => {
    // Chain 0-1-2-3 with a building at the 1/2 junction: segments of 2 and 2.
    const chain = [ring[0], ring[1], ring[2], ring[3]]
    const junction = sharedVertex(ring[1], ring[2])
    const open = roads(twoPlayerBoard(), 'aki', chain)
    expect(longestRoadLength(open, 'aki')).toBe(4)

    const blocked = placeBuilding(open, junction, 'b', 'settlement')
    expect(longestRoadLength(blocked, 'aki')).toBe(2)

    const own = placeBuilding(open, junction, 'aki', 'settlement')
    expect(longestRoadLength(own, 'aki')).toBe(4)
  })

  it('searches the densest legal road network exhaustively', () => {
    // Three hexes around one vertex: 15 edges, the most a legal player can own,
    // and the densest 15-edge shape on the grid. Pins TRAVERSAL_BUDGET above what
    // real play needs — lower it and this exact answer degrades to a lower bound.
    const flower = [...new Set(vertexTripleAt({ q: 0, r: 0 }, 0).flatMap((hex) => hexEdgeIds(hex)))]
    expect(flower).toHaveLength(15)
    expect(longestRoadLength(roads(twoPlayerBoard(), 'aki', flower), 'aki')).toBe(14)
  })

  it('reports the longest of disconnected segments', () => {
    const far = hexEdgeIds({ q: -1, r: 0 })
    const board = roads(twoPlayerBoard(), 'aki', [ring[0], far[2], far[3], far[4]])
    expect(longestRoadLength(board, 'aki')).toBe(3)
  })
})

describe('computeStandings', () => {
  it('derives piece counts from the board', () => {
    const grid = createBoard('standard4')
    let board = addPlayer(grid, { id: 'b', name: 'Bee', color: '#3063ba' })
    const vertices = [...new Set(ring.flatMap((edge) => edgeEndpointVertexIds(edge)))]
    board = placeBuilding(board, vertices[0], 'aki', 'settlement')
    board = placeBuilding(board, vertices[2], 'aki', 'city')
    board = placeBuilding(board, vertices[4], 'b', 'superCity')
    board = roads(board, 'aki', [ring[0]])
    const standings = computeStandings(newGame(board))
    expect(standings.find((entry) => entry.playerId === 'aki')).toMatchObject({
      settlements: 1,
      cities: 1,
      superCities: 0,
      roads: 1,
    })
    expect(standings.find((entry) => entry.playerId === 'b')).toMatchObject({
      settlements: 0,
      cities: 0,
      superCities: 1,
      roads: 0,
    })
  })

  it('awards longest road at five plus, to whoever got there first', () => {
    let board = roads(twoPlayerBoard(), 'aki', ring.slice(0, 5))
    let game = newGame(board)
    expect(standingFor(game, 'aki')).toMatchObject({ longestRoad: 5, hasLongestRoad: true })
    expect(standingFor(game, 'b')).toMatchObject({ hasLongestRoad: false })

    // Four roads never earn the award.
    game = newGame(roads(twoPlayerBoard(), 'aki', ring.slice(0, 4)))
    expect(standingFor(game, 'aki').hasLongestRoad).toBe(false)

    // A tie leaves the card where it is: aki reached five first, so matching it
    // does not take it away. b builds on a hex that shares no edge with the
    // centre ring, or placeRoad would overwrite aki's roads instead.
    board = roads(twoPlayerBoard(), 'aki', ring.slice(0, 5))
    board = roads(board, 'b', outerRing.slice(0, 5))
    game = newGame(board)
    expect(standingFor(game, 'aki')).toMatchObject({ longestRoad: 5, hasLongestRoad: true })
    expect(standingFor(game, 'b')).toMatchObject({ longestRoad: 5, hasLongestRoad: false })

    // Beating it outright does take it, and the loser keeps their run length.
    board = roads(board, 'b', outerRing.slice(5, 6))
    game = newGame(board)
    expect(standingFor(game, 'aki')).toMatchObject({ longestRoad: 5, hasLongestRoad: false })
    expect(standingFor(game, 'b')).toMatchObject({ longestRoad: 6, hasLongestRoad: true })
  })

  it('gives longest road back when the original holder retakes the lead', () => {
    // aki to five, b overtakes at six, aki extends past them.
    let board = roads(twoPlayerBoard(), 'aki', ring.slice(0, 5))
    board = roads(board, 'b', outerRing)
    expect(standingFor(newGame(board), 'b').hasLongestRoad).toBe(true)

    // A spur off the centre ring pushes aki's run past b's, which takes the
    // card back — the rule is strictly-beats, in either direction.
    const spur = hexEdgeIds({ q: 1, r: 0 }).filter((edge) => !ring.includes(edge))
    board = roads(board, 'aki', spur)
    const aki = standingFor(newGame(board), 'aki')
    const bee = standingFor(newGame(board), 'b')
    expect(aki.longestRoad).toBeGreaterThan(bee.longestRoad)
    expect(aki.hasLongestRoad).toBe(true)
    expect(bee.hasLongestRoad).toBe(false)
  })

  it('awards largest army at three plus knights, unique max only', () => {
    let game = adjustCounter(newGame(twoPlayerBoard()), 'aki', 'knights', 3)
    expect(standingFor(game, 'aki').hasLargestArmy).toBe(true)
    expect(standingFor(game, 'b').hasLargestArmy).toBe(false)

    game = adjustCounter(newGame(twoPlayerBoard()), 'aki', 'knights', 2)
    expect(standingFor(game, 'aki').hasLargestArmy).toBe(false)

    let tied = adjustCounter(newGame(twoPlayerBoard()), 'aki', 'knights', 3)
    tied = adjustCounter(tied, 'b', 'knights', 3)
    expect(standingFor(tied, 'aki').hasLargestArmy).toBe(false)
    expect(standingFor(tied, 'b').hasLargestArmy).toBe(false)
  })

  it('memoizes on game identity but never serves stale standings', () => {
    const game = newGame(twoPlayerBoard())
    expect(computeStandings(game)).toBe(computeStandings(game))

    // The directions that matter: a stat edit and a board edit must both produce
    // a new game, so neither can read through to the cached standings.
    const armed = adjustCounter(game, 'aki', 'knights', 3)
    expect(standingFor(armed, 'aki').hasLargestArmy).toBe(true)
    expect(standingFor(game, 'aki').hasLargestArmy).toBe(false)

    const built = withBoard(armed, placeBuilding(armed.board, sharedVertex(ring[0], ring[1]), 'aki', 'city'))
    expect(standingFor(built, 'aki').cities).toBe(1)
    expect(standingFor(armed, 'aki').cities).toBe(0)
  })

  it('sums victory points: pieces, awards, and vp cards', () => {
    const vertices = [...new Set(ring.flatMap((edge) => edgeEndpointVertexIds(edge)))]
    let board = twoPlayerBoard()
    board = placeBuilding(board, vertices[0], 'aki', 'settlement') // 1
    board = placeBuilding(board, vertices[2], 'aki', 'city') // 2
    board = placeBuilding(board, vertices[4], 'aki', 'superCity') // SUPER_CITY_VP
    board = roads(board, 'aki', ring.slice(0, 5).map((edge) => edge)) // longest road +2
    let game = newGame(board)
    game = adjustCounter(game, 'aki', 'knights', 3) // largest army +2
    game = adjustCounter(game, 'aki', 'vpCards', 1) // +1
    expect(standingFor(game, 'aki').victoryPoints).toBe(1 + 2 + SUPER_CITY_VP + 2 + 2 + 1)
    expect(standingFor(game, 'b').victoryPoints).toBe(0)
  })
})
