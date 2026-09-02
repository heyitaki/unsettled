import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, movePlayer, placeBuilding, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import type { Board } from '../../model/types'
import { draftIsComplete, inferDraftState, type DraftState } from '../draft'

function twoPlayerBoard(): Board {
  return addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
}

function expectInvariant(draft: DraftState): void {
  expect(draft.myRemainingPickIndices).toEqual([...draft.myRemainingPickIndices].sort((a, b) => a - b))
  if (draft.turnIndex !== null) {
    expect(draft.myRemainingPickIndices.every((index) => index >= draft.turnIndex!)).toBe(true)
  }
}

describe('draft-state inference', () => {
  it('infers an empty two-player snake', () => {
    const draft = inferDraftState(twoPlayerBoard())
    expect(draft.sequence).toEqual(['aki', 'b', 'b', 'aki'])
    expect(draft.turnIndex).toBe(0)
    expect(draft.myRemainingPickIndices).toEqual([0, 3])
    expectInvariant(draft)
  })

  it('handles a consistent mid-draft and one remaining pick', () => {
    const board = placeBuilding(twoPlayerBoard(), boardGrid('standard4').vertexIds[0], 'aki', 'settlement')
    const draft = inferDraftState(board)
    expect(draft.currentPlayerId).toBe('b')
    expect(draft.myRemainingPickIndices).toEqual([3])
    expectInvariant(draft)
  })

  it('infers the not-my-turn five-player fixture shape', () => {
    let board = createBoard('standard4')
    for (let index = 2; index <= 5; index += 1) {
      board = addPlayer(board, { id: `p${index}`, name: `P${index}`, color: '#333333' })
    }
    board = setMe(board, 'p4')
    const draft = inferDraftState(board)
    expect(draft.myPickIndices).toEqual([3, 6])
    expect(draft.currentPlayerId).toBe('aki')
    expectInvariant(draft)
  })

  it('takes the snake from seat order, so a moved player picks from the new seat (B3)', () => {
    let board = createBoard('standard4')
    for (const id of ['b', 'c', 'd']) board = addPlayer(board, { id, name: id, color: '#333333' })
    board = setMe(board, 'd')
    expect(inferDraftState(board).myPickIndices).toEqual([3, 4])
    const moved = inferDraftState(movePlayer(board, 'd', 0))
    expect(moved.sequence[0]).toBe('d')
    expect(moved.sequence).toEqual(['d', 'aki', 'b', 'c', 'c', 'b', 'aki', 'd'])
    expect(moved.myPickIndices).toEqual([0, 7])
    expectInvariant(moved)
  })

  it('recognizes complete-by-count, complete-by-city, and an overfilled sequence', () => {
    const vertices = boardGrid('standard4').vertexIds
    let byCount = twoPlayerBoard()
    for (let index = 0; index < 4; index += 1) {
      byCount = placeBuilding(byCount, vertices[index], index === 0 || index === 3 ? 'aki' : 'b', 'settlement')
    }
    const countDraft = inferDraftState(byCount)
    expect(draftIsComplete(byCount, countDraft)).toBe(true)
    expectInvariant(countDraft)

    const byCity = placeBuilding(twoPlayerBoard(), vertices[0], 'aki', 'city')
    const cityDraft = inferDraftState(byCity)
    expect(draftIsComplete(byCity, cityDraft)).toBe(true)
    expect(cityDraft.warnings).toContain('non-settlement-buildings')
    expectInvariant(cityDraft)

    const overfilled = {
      ...twoPlayerBoard(),
      buildings: vertices.slice(0, 5).map((vertexId, index) => ({
        vertexId,
        playerId: index % 2 === 0 ? 'aki' : 'b',
        tier: 'settlement' as const,
      })),
    }
    const overfilledDraft = inferDraftState(overfilled)
    expect(draftIsComplete(overfilled, overfilledDraft)).toBe(true)
    expectInvariant(overfilledDraft)
  })

  it('stays quiet about snake order once the draft is over', () => {
    const vertices = boardGrid('standard4').vertexIds
    // Mid-game: aki upgraded one starting settlement and built two more, so the
    // per-player counts no longer match the snake — that is normal play, not a
    // broken draft.
    const midGame = {
      ...twoPlayerBoard(),
      buildings: [
        { vertexId: vertices[0], playerId: 'aki', tier: 'city' as const },
        { vertexId: vertices[1], playerId: 'b', tier: 'settlement' as const },
        { vertexId: vertices[2], playerId: 'b', tier: 'settlement' as const },
        { vertexId: vertices[3], playerId: 'aki', tier: 'settlement' as const },
        { vertexId: vertices[4], playerId: 'aki', tier: 'settlement' as const },
        { vertexId: vertices[5], playerId: 'aki', tier: 'settlement' as const },
      ],
    }
    const draft = inferDraftState(midGame)
    expect(draftIsComplete(midGame, draft)).toBe(true)
    expect(draft.warnings).not.toContain('snake-inconsistent')
    expectInvariant(draft)
  })

  it('drops a missing earlier me pick and warns', () => {
    const board = placeBuilding(twoPlayerBoard(), boardGrid('standard4').vertexIds[0], 'b', 'settlement')
    const draft = inferDraftState(board)
    expect(draft.warnings).toContain('snake-inconsistent')
    expect(draft.myRemainingPickIndices).toEqual([3])
    expectInvariant(draft)
  })

  it('handles unknown-owner and placed-early inconsistencies', () => {
    const vertexId = boardGrid('standard4').vertexIds[0]
    const unknownOwner = {
      ...twoPlayerBoard(),
      buildings: [{ vertexId, playerId: 'outside', tier: 'settlement' as const }],
    }
    const unknownDraft = inferDraftState(unknownOwner)
    expect(unknownDraft.warnings).toContain('snake-inconsistent')
    expectInvariant(unknownDraft)

    const placedEarly = placeBuilding(setMe(twoPlayerBoard(), 'b'), vertexId, 'b', 'settlement')
    const earlyDraft = inferDraftState(placedEarly)
    expect(earlyDraft.warnings).toContain('snake-inconsistent')
    expect(earlyDraft.myRemainingPickIndices).toEqual([2])
    expectInvariant(earlyDraft)
  })

  it('warns for a solo roster and handles null or stale me ids', () => {
    const soloDraft = inferDraftState(createBoard('standard4'))
    expect(soloDraft.warnings).toContain('solo-roster')
    expectInvariant(soloDraft)

    const noMe = inferDraftState(setMe(twoPlayerBoard(), null))
    expect(noMe.myPickIndices).toEqual([])
    expectInvariant(noMe)

    const stale = inferDraftState({ ...twoPlayerBoard(), mePlayerId: 'missing' })
    expect(stale.myPickIndices).toEqual([])
    expectInvariant(stale)
  })
})
