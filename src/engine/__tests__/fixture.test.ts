import { describe, expect, it } from 'vitest'
import fixture from '../../parser/__tests__/expected/board-draft-empty.json'
import type { Board } from '../../model/types'
import { analyzeBoard } from '../analyze'
import { breakdownTotal } from '../valuation'

describe('imported draft fixture', () => {
  it('produces stable structural recommendations', () => {
    const board = fixture as Board
    const first = analyzeBoard(board, { seed: 7 })
    expect(first.status).toBe('ready')
    expect(first.draft.sequence).toHaveLength(10)
    expect(first.draft.myPickIndices).toEqual([3, 6])
    expect(first.draft.currentPlayerId).toBe('p1')
    expect(first.recommendations.length).toBeGreaterThan(0)
    expect(new Set(first.recommendations.map((entry) => entry.firstPick)).size)
      .toBe(first.recommendations.length)
    for (let index = 0; index < first.recommendations.length; index += 1) {
      const entry = first.recommendations[index]
      expect(breakdownTotal(entry.breakdown)).toBeCloseTo(entry.score)
      if (index > 0) {
        expect(first.recommendations[index - 1].rankScore).toBeGreaterThanOrEqual(entry.rankScore)
      }
    }
    expect(analyzeBoard(board, { seed: 7 })).toEqual(first)
  })
})
