import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, pips, setTile } from '../../model/board'
import { axialKey, vertexTouchingHexes } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { RESOURCES, type Board, type Resource, type VertexId } from '../../model/types'
import { rankCandidates, type AnalysisOptions, type PreWindowResult } from '../analyze'
import type { DraftState } from '../draft'
import { neutralModifier } from '../modifiers'
import { computeBoardContext } from '../valuation'
import { DEFAULT_WEIGHTS, type EngineWeights } from '../weights'

/**
 * SU-7 (rules corpus, S1:1406-1409): the *second* settlement of setup — and
 * only the second — grants one resource card per adjacent producing hex, taken
 * immediately. The scorer must therefore value a candidate differently as a
 * first pick and as a second pick. Reproduction from the rules audit
 * (`.claude/pairs/sim-rules-audit`, OBJ-8), promoted to the tracked suite.
 */

const grid = boardGrid('standard4')

function productiveBoard(): Board {
  let board = addPlayer(createBoard('standard4'), {
    id: 'p2',
    name: 'P2',
    color: '#333333',
  })
  const tokens = [6, 8, 5, 9, 4, 10, 3, 11, 2, 12] as const
  for (let index = 0; index < board.hexes.length; index += 1) {
    board = setTile(
      board,
      board.hexes[index].coord,
      RESOURCES[index % RESOURCES.length],
      tokens[index % tokens.length],
    )
  }
  return board
}

const options: Required<AnalysisOptions> = {
  seed: 7,
  rollouts: 1,
  weights: DEFAULT_WEIGHTS,
  modifier: neutralModifier,
  maxResults: 54,
}

const preWindows: PreWindowResult[] = [{
  blocked: new Set(),
  taken: [],
}]

/** Snake order `aki, p2, p2, aki`: turn 0 is my first pick, turn 3 my second. */
function draftForPick(turnIndex: 0 | 3): DraftState {
  const sequence = ['aki', 'p2', 'p2', 'aki']
  return {
    sequence,
    placedCount: turnIndex,
    turnIndex,
    currentPlayerId: 'aki',
    myPickIndices: [0, 3],
    myRemainingPickIndices: [turnIndex],
    remainingPickIndices: [turnIndex],
    warnings: [],
  }
}

const rank = (board: Board, turnIndex: 0 | 3, weights: EngineWeights = DEFAULT_WEIGHTS) =>
  rankCandidates(
    computeBoardContext(board, weights),
    board,
    draftForPick(turnIndex),
    preWindows,
    { ...options, weights },
  )

/**
 * The grant the rules hand out at this vertex, priced through `resourceValue`:
 * one card per adjacent hex that produces, desert and sea excluded. Restated
 * here rather than imported so the test pins the modelled quantity instead of
 * echoing whatever the scorer computes.
 */
function expectedHandValue(board: Board, vertexId: VertexId, weights: EngineWeights): number {
  const touching = new Set(vertexTouchingHexes(vertexId).map(axialKey))
  let value = 0
  for (const hex of board.hexes) {
    if (!touching.has(axialKey(hex.coord))) continue
    if (!hex.tile || hex.tile === 'desert' || pips(hex.numberToken) <= 0) continue
    value += weights.resourceValue[hex.tile]
  }
  return value * weights.handValueWeight
}

const threeHexVertex = grid.vertexIds.find((vertex) =>
  vertexTouchingHexes(vertex).filter((coord) => grid.landKeys.has(axialKey(coord))).length === 3)
if (!threeHexVertex) throw new Error('standard4 has no three-hex vertex')

/**
 * The adopted default weight is 0 (M-43/M-46: under competent play the grant's
 * value is realized in-game, so the placement-time term double counts). The
 * term itself survives, and every mechanism assertion below reduces to a
 * tautology at a zero weight, so the suite pins the mechanism at the pre-drop
 * weight instead of the shipped default.
 */
const witnessWeights: EngineWeights = { ...DEFAULT_WEIGHTS, handValueWeight: 0.4 }

describe('second settlement resource grant (SU-7)', () => {
  it('ships disabled by default since the Phase-I adoption', () => {
    expect(DEFAULT_WEIGHTS.handValueWeight).toBe(0)
  })

  it('makes a candidate worth more as a second pick than as a first pick', () => {
    const board = productiveBoard()
    const firstPick = rank(board, 0, witnessWeights)
    const secondPick = rank(board, 3, witnessWeights)
    const first = firstPick.recommendations[0]
    const second = secondPick.recommendations.find(
      (recommendation) => recommendation.firstPick === first.firstPick,
    )

    expect(second).toBeDefined()
    expect(second!.score).toBeGreaterThan(first.score)
  })

  it('grants nothing on the first pick, leaving today\'s score exactly intact', () => {
    const board = productiveBoard()
    const firstPick = rank(board, 0, witnessWeights)
    for (const recommendation of firstPick.recommendations) {
      expect(recommendation.breakdown.handValue).toBe(0)
    }
    // Pinned at 23d1987, before the grant existed: the first pick is the
    // mirror-image guard against applying the grant unconditionally. Re-pinned on the SP6
    // adoption, which put `expansionWeight` on 0.1 and so moved every score on this board; it
    // read 17.502774503013576 while the walk was off.
    expect(firstPick.recommendations[0].score).toBe(18.531650153123863)
  })

  it('prices the second pick as one card per adjacent producing hex', () => {
    const board = productiveBoard()
    const secondPick = rank(board, 3, witnessWeights)
    expect(secondPick.recommendations.length).toBeGreaterThan(0)
    for (const recommendation of secondPick.recommendations) {
      expect(recommendation.breakdown.handValue).toBeCloseTo(
        expectedHandValue(board, recommendation.firstPick, witnessWeights),
        12,
      )
    }
  })

  it('counts only producing hexes, so a desert neighbour is worth exactly nothing', () => {
    const producing = productiveBoard()
    const sacrificed = vertexTouchingHexes(threeHexVertex).find((coord) =>
      grid.landKeys.has(axialKey(coord)))
    if (!sacrificed) throw new Error('three-hex vertex touches no land')
    const lost = producing.hexes.find((hex) => axialKey(hex.coord) === axialKey(sacrificed))?.tile
    if (!lost || lost === 'desert') throw new Error('sacrificed hex does not produce')
    const withDesert = setTile(producing, sacrificed, 'desert', null)

    const before = rank(producing, 3, witnessWeights).recommendations
      .find((recommendation) => recommendation.firstPick === threeHexVertex)
    const after = rank(withDesert, 3, witnessWeights).recommendations
      .find((recommendation) => recommendation.firstPick === threeHexVertex)
    expect(before).toBeDefined()
    expect(after).toBeDefined()

    // Same vertex, same neighbours, one of them no longer producing: the whole
    // difference in `handValue` is that hex's card and nothing else.
    expect(after!.breakdown.handValue).toBeLessThan(before!.breakdown.handValue)
    expect(before!.breakdown.handValue - after!.breakdown.handValue).toBeCloseTo(
      witnessWeights.resourceValue[lost as Resource] * witnessWeights.handValueWeight,
      12,
    )
  })
})
