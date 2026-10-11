import { expect, it } from 'vitest'
import type { AdviceAction, ScoredAdvice } from '../../engine/advice/protocol'
import { emptyStats } from '../../model/game'
import { limitTradeOffers } from '../bestMoves'

it('keeps the three highest-scored trade offers without changing other actions or their order', () => {
  const actions: AdviceAction[] = [
    { type: 'buyDev' },
    { type: 'offerTrade', give: 'wood', get: 'ore', count: 1 },
    { type: 'offerTrade', give: 'brick', get: 'ore', count: 1 },
    { type: 'tradeBank', give: 'wood', get: 'ore', count: 1, rate: 4 },
    { type: 'offerTrade', give: 'sheep', get: 'ore', count: 1 },
    { type: 'offerTrade', give: 'wheat', get: 'ore', count: 1 },
    { type: 'buyDev' },
    { type: 'offerTrade', give: 'wood', get: 'ore', count: 2 },
    { type: 'pass' },
  ]
  const ranked: readonly ScoredAdvice[] = Object.freeze(actions.map((action, index) => ({ action, score: [5, 1, 40, 3, 20, 50, 2, 10, 0][index], reason: '', handDelta: emptyStats().hand })))
  expect(limitTradeOffers(ranked)).toEqual([ranked[0], ranked[2], ranked[3], ranked[4], ranked[5], ranked[6], ranked[8]])
  expect(limitTradeOffers(ranked.slice(0, 4))).toEqual(ranked.slice(0, 4))
})
