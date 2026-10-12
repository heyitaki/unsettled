import { describe, expect, it } from 'vitest'
import { createBoard, placeRoad } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { longestRoadLength } from '../stats'

describe('longest road performance', () => {
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
})
