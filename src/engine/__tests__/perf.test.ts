import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  placeRoad,
  randomizeBoard,
  setMe,
  setRobber,
  setTile,
} from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { analyzeBoard, rolloutCount } from '../analyze'
import { longestRoadLength } from '../stats'
import { DEFAULT_WEIGHTS } from '../weights'

function worstCaseBoard() {
  let board = createBoard('extension6')
  for (let index = 2; index <= 6; index += 1) {
    board = addPlayer(board, { id: `p${index}`, name: `P${index}`, color: '#333333' })
  }
  board = setMe(board, 'aki')
  board = randomizeBoard(board)
  const resources = ['wood', 'sheep', 'wheat', 'brick', 'ore'] as const
  const tokens = [5, 6, 8, 9, 10, 4, 11, 3] as const
  for (let index = 0; index < board.hexes.length; index += 1) {
    board = setTile(
      board,
      board.hexes[index].coord,
      resources[index % resources.length],
      tokens[index % tokens.length],
    )
  }
  return setRobber(board, board.hexes[0].coord)
}

describe('rollout performance', () => {
  it('keeps the adaptive budget formula calibrated for all four draft shapes', () => {
    expect(rolloutCount(80, 0, 10, DEFAULT_WEIGHTS)).toBe(7)
    expect(rolloutCount(80, 3, 2, DEFAULT_WEIGHTS)).toBe(24)
    expect(rolloutCount(80, 5, 0, DEFAULT_WEIGHTS)).toBe(24)
    expect(rolloutCount(80, 10, 0, DEFAULT_WEIGHTS)).toBe(24)
  })

  it('bounds the longest-road search when one player owns every edge', () => {
    // Nothing caps a player at 15 roads, so the road tool and legacy imports can
    // both reach this; exhaustively it ran ~22s and froze the tab.
    const board = boardGrid('standard4').edgeIds.reduce(
      (acc, edgeId) => placeRoad(acc, edgeId, 'aki'),
      createBoard('standard4'),
    )
    longestRoadLength(board, 'aki')
    const start = performance.now()
    console.time('longestRoadLength all-edges')
    const length = longestRoadLength(board, 'aki')
    console.timeEnd('longestRoadLength all-edges')
    expect(length).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(500)
  })

  // The bound was 500ms while `expansionWeight` shipped at 0 and the walk never ran. M-66, the
  // SP6 gate, adopted the term at 0.1, and the walk prices every site a candidate opens with the
  // full marginal formula: about sixteen extra scorings per scored candidate, which on this board
  // is 5.8 million of them. That is what an analysis of the largest board now costs, and no
  // rewrite of the walk closes a gap that size. The number is the measured worst case with
  // headroom for a slow machine, so it still fires on a regression rather than on contention.
  it('analyzes the worst-case six-player opening under the CI tripwire', () => {
    const board = worstCaseBoard()
    analyzeBoard(board)
    const start = performance.now()
    console.time('analyzeBoard worst-case')
    const analysis = analyzeBoard(board)
    console.timeEnd('analyzeBoard worst-case')
    const elapsed = performance.now() - start
    expect(analysis.status).toBe('ready')
    expect(elapsed).toBeLessThan(3000)
  })
})
