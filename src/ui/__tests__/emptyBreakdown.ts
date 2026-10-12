import type { ScoreBreakdown } from '../../engine/analysisProtocol'

export const emptyBreakdown = (): ScoreBreakdown =>
  ({ production: 0, scarcity: 0, robber: 0, diversity: 0, port: 0, handValue: 0, expansion: 0 })
