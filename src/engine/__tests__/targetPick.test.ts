import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { RESOURCES, type Board } from '../../model/types'
import { analyzeBoard, type DraftAnalysis } from '../analyze'
import { blockedVertices } from '../legality'

const tokens = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12] as const

// Four seats on a fully tiled board, so the snake runs aki p2 p3 p4 p4 p3 p2 aki.
function filledBoard(): Board {
  let board = createBoard('standard4')
  for (let index = 2; index <= 4; index += 1) {
    board = addPlayer(board, { id: `p${index}`, name: `P${index}`, color: '#333333' })
  }
  for (let index = 0; index < board.hexes.length; index += 1) {
    const resource = RESOURCES[(index * 3 + 21 + Math.floor(index / 3)) % RESOURCES.length]
    const token = tokens[(index * 7 + 9) % tokens.length]
    board = setTile(board, board.hexes[index].coord, resource, token)
  }
  return board
}

const SAMPLED = { seed: 5, rollouts: 4 }
const scores = (analysis: DraftAnalysis) =>
  [...analysis.recommendations]
    .map(({ firstPick, score }) => [firstPick, score] as const)
    .sort(([a], [b]) => a.localeCompare(b))

describe('analyzeBoard with a target pick', () => {
  it.each([undefined, 6])('reports progress that only rises and ends at 1 (target %s)', (targetPick) => {
    const board = setMe(filledBoard(), 'p2')
    const seen: number[] = []
    const analysis = analyzeBoard(board, { ...SAMPLED, targetPick, onProgress: (fraction) => seen.push(fraction) })
    expect(analysis).toEqual(analyzeBoard(board, { ...SAMPLED, targetPick }))
    expect(seen.length).toBeGreaterThan(5)
    expect(seen.at(-1)).toBeCloseTo(1)
    expect(seen.every((fraction, index) => fraction > 0 && fraction >= (seen[index - 1] ?? 0))).toBe(true)
    // Six picks stand before p2's second, each a ranking of its own, so most of the bar is theirs.
    if (targetPick !== undefined) expect(seen.filter((fraction) => fraction < 0.9).length).toBeGreaterThan(5)
  })

  it('leaves the whole bar to the work still to do when the nested rankings are already held', () => {
    const board = setMe(filledBoard(), 'p2')
    const modalCache = new Map<string, DraftAnalysis>()
    analyzeBoard(board, { ...SAMPLED, targetPick: 6, modalCache })
    const seen: number[] = []
    analyzeBoard(board, { ...SAMPLED, targetPick: 6, modalCache, onProgress: (fraction) => seen.push(fraction) })
    expect(seen[0]).toBeLessThan(0.1)
    expect(seen.at(-1)).toBeCloseTo(1)
    expect(seen.every((fraction, index) => fraction >= (seen[index - 1] ?? 0))).toBe(true)
  })

  it('ranks my next pick exactly as before when the target names it', () => {
    const board = setMe(filledBoard(), 'p2')
    const base = analyzeBoard(board, SAMPLED)
    expect(base.status).toBe('ready')
    expect(analyzeBoard(board, { ...SAMPLED, targetPick: 1 })).toEqual(base)
  })

  it('falls back to my next pick when the target is not a pick of mine still to come', () => {
    const board = setMe(filledBoard(), 'p2')
    const base = analyzeBoard(board, SAMPLED)
    // A rival's slot, and a slot past the end of the snake.
    expect(analyzeBoard(board, { ...SAMPLED, targetPick: 0 })).toEqual(base)
    expect(analyzeBoard(board, { ...SAMPLED, targetPick: 99 })).toEqual(base)
  })

  it('ranks a later pick behind a window that holds every pick before it, my own included', () => {
    const board = setMe(filledBoard(), 'p2')
    const analysis = analyzeBoard(board, { ...SAMPLED, targetPick: 6 })
    expect(analysis.status).toBe('ready')
    expect(analysis.takenBeforeFirstPick.map(({ playerId }) => playerId))
      .toEqual(['aki', 'p2', 'p3', 'p4', 'p4', 'p3'])
    expect(analysis.recommendations.length).toBeGreaterThan(0)
    // Nothing follows my last pick.
    expect(analysis.recommendations.every(({ plannedSecond }) => plannedSecond.length === 0)).toBe(true)
  })

  it('lists only spots the modal line leaves standing', () => {
    const board = setMe(filledBoard(), 'p2')
    const greedy = analyzeBoard(board, { rollouts: 1, targetPick: 6, maxResults: 54 })
    const blocked = blockedVertices(board.layout, greedy.takenBeforeFirstPick.map(({ vertexId }) => vertexId))
    expect(greedy.recommendations.length).toBeGreaterThan(0)
    expect(greedy.recommendations.every(({ firstPick, survival }) =>
      survival === 1 && !blocked.has(firstPick))).toBe(true)
  })

  it('scores the later pick as the board would once the modal line is really played', () => {
    const board = setMe(filledBoard(), 'p2')
    const greedy = analyzeBoard(board, { rollouts: 1, targetPick: 6, maxResults: 54 })
    // Play the line out for real: it is then p2's turn at slot 6, with nothing left to simulate.
    const played = greedy.takenBeforeFirstPick.reduce((next, { vertexId, playerId }) =>
      placeBuilding(next, vertexId, playerId, 'settlement'), board)
    const direct = analyzeBoard(played, { rollouts: 1, maxResults: 54 })
    expect(direct.takenBeforeFirstPick).toEqual([])
    const viewed = scores(greedy)
    const actual = scores(direct)
    expect(viewed.map(([vertexId]) => vertexId)).toEqual(actual.map(([vertexId]) => vertexId))
    viewed.forEach(([, score], index) => expect(score).toBeCloseTo(actual[index][1], 9))
  })

  it('reuses the modal line across calls through a shared cache, whoever is claimed', () => {
    const board = setMe(filledBoard(), 'p2')
    const cache = new Map()
    const cached = analyzeBoard(board, { ...SAMPLED, targetPick: 6, modalCache: cache })
    expect(cached).toEqual(analyzeBoard(board, { ...SAMPLED, targetPick: 6 }))
    expect(cache.size).toBeGreaterThan(0)

    // p3 first picks third: the two rankings ahead of it open the line already cached.
    const size = cache.size
    const third = setMe(board, 'p3')
    expect(analyzeBoard(third, { ...SAMPLED, modalCache: cache })).toEqual(analyzeBoard(third, SAMPLED))
    expect(cache.size).toBe(size)
  })
})
