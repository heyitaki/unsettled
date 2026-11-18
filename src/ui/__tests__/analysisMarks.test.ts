import { describe, expect, it } from 'vitest'
import type { Recommendation } from '../../engine/analysisProtocol'
import type { EdgeId, VertexId } from '../../model/types'
import { recommendationMarks } from '../analysisMarks'

const FIRST = 'v:-1,0;-1,1;0,0' as VertexId
const SECOND = 'v:0,0;0,1;1,0' as VertexId
const ROAD = 'e:-1,1;0,0' as EdgeId
const SECOND_ROAD = 'e:0,1;1,0' as EdgeId

const recommendation = (firstRoad: EdgeId | null, secondRoad: EdgeId | null = null): Recommendation => ({
  firstPick: FIRST,
  firstRoad,
  secondRoad,
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
})

describe('recommendationMarks', () => {
  it('marks the road beside the pair when the pick opens one', () => {
    expect(recommendationMarks(recommendation(ROAD), '#3063ba')).toEqual([
      { ref: FIRST, color: '#3063ba', label: '1', placeable: true },
      { ref: SECOND, color: '#3063ba', label: '2', faded: true },
      { ref: ROAD, color: '#3063ba', label: 'R', kind: 'road' },
    ])
  })

  it('marks only the pair when there is no road', () => {
    expect(recommendationMarks(recommendation(null), '#3063ba')).toEqual([
      { ref: FIRST, color: '#3063ba', label: '1', placeable: true },
      { ref: SECOND, color: '#3063ba', label: '2', faded: true },
    ])
  })

  it("numbers the mark as the player's second settlement when that is the pick ranked", () => {
    expect(recommendationMarks({ ...recommendation(null), plannedSecond: [] }, '#3063ba', 2)).toEqual([
      { ref: FIRST, color: '#3063ba', label: '2', placeable: true },
    ])
  })

  it('marks the planned second pick\'s road faded, after the first pick\'s', () => {
    expect(recommendationMarks(recommendation(ROAD, SECOND_ROAD), '#3063ba')).toEqual([
      { ref: FIRST, color: '#3063ba', label: '1', placeable: true },
      { ref: SECOND, color: '#3063ba', label: '2', faded: true },
      { ref: ROAD, color: '#3063ba', label: 'R', kind: 'road' },
      { ref: SECOND_ROAD, color: '#3063ba', label: 'R', kind: 'road', faded: true },
    ])
  })
})
