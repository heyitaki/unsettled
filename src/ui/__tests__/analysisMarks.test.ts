import { describe, expect, it } from 'vitest'
import type { Recommendation } from '../../engine/analyze'
import type { EdgeId, VertexId } from '../../model/types'
import { recommendationMarks } from '../analysisMarks'

const FIRST = 'v:-1,0;-1,1;0,0' as VertexId
const SECOND = 'v:0,0;0,1;1,0' as VertexId
const ROAD = 'e:-1,1;0,0' as EdgeId

const recommendation = (firstRoad: EdgeId | null): Recommendation => ({
  firstPick: FIRST,
  firstRoad,
  plannedSecond: [SECOND],
  survival: 1,
  score: 12,
  rankScore: 12,
  breakdown: {
    production: 12,
    scarcity: 0,
    robber: 0,
    diversity: 0,
    port: 0,
    handValue: 0,
    expansion: 0,
  },
  expectedTaken: [],
})

describe('recommendationMarks', () => {
  it('marks the road beside the pair when the pick opens one', () => {
    expect(recommendationMarks(recommendation(ROAD), '#3063ba')).toEqual([
      { ref: FIRST, color: '#3063ba', label: '1' },
      { ref: SECOND, color: '#3063ba', label: '2' },
      { ref: ROAD, color: '#3063ba', label: 'R' },
    ])
  })

  it('marks only the pair when there is no road', () => {
    expect(recommendationMarks(recommendation(null), '#3063ba')).toEqual([
      { ref: FIRST, color: '#3063ba', label: '1' },
      { ref: SECOND, color: '#3063ba', label: '2' },
    ])
  })
})
