import type { Game } from '../../model/game'
import type { AxialCoord, EdgeId, Resource, VertexId } from '../../model/types'

export type Cards = Record<Resource, number>

export type Decision =
  | { kind: 'turn' }
  | { kind: 'preRoll' }
  | { kind: 'discard' }
  | { kind: 'robber' }
  /** The proposer gives `count` (1 or 2) of `give` and wants one `get` from the observer. */
  | { kind: 'tradeResponse'; proposer: string; give: Resource; get: Resource; count: 1 | 2 }
  | { kind: 'produce'; total: number }

export interface AdviceRequest {
  game: Game
  /** The player the advice is for. */
  observer: string
  decision: Decision
}

export type KnightPlay = { type: 'playKnight'; hex: AxialCoord; victim: string | null }

export type AdviceAction =
  | { type: 'buildRoad'; edgeId: EdgeId }
  | { type: 'buildSettlement'; vertexId: VertexId }
  | { type: 'upgradeCity'; vertexId: VertexId }
  | { type: 'buyDev' }
  | KnightPlay
  /** Pay `rate * count` of `give` for `count` of `get`. */
  | { type: 'tradeBank'; give: Resource; get: Resource; count: number; rate: number }
  /** Offer `count` (1 or 2) of `give` for one `get`. */
  | { type: 'offerTrade'; give: Resource; get: Resource; count: number }
  | { type: 'pass' }

export type PreRollPlay =
  | KnightPlay
  | { type: 'roadBuilding'; first: EdgeId | null; second: EdgeId | null }
  | { type: 'yearOfPlenty'; first: Resource; second: Resource }
  | { type: 'monopoly'; resource: Resource }

export interface Derived {
  devDeckRemaining: number
  bank: Cards
  /** The observer's cards of unknown type, which the advice ignored. */
  unknownOwnCards: number
  /** The observer's bank rate per resource: 4, 3 or 2. */
  tradeRates: Cards
}

export interface ScoredAdvice {
  action: AdviceAction
  score: number
  reason: string
  /** Signed change to the observer's hand if the action is taken; zeros when it depends on someone else. */
  handDelta: Cards
}

export type AdviceResponse =
  | { kind: 'turn'; actions: ScoredAdvice[]; derived: Derived }
  | { kind: 'preRoll'; play: PreRollPlay | null; reason: string; derived: Derived }
  | { kind: 'discard'; count: number; cards: Cards; reason: string; derived: Derived }
  | { kind: 'robber'; hex: AxialCoord; victim: string | null; reason: string; derived: Derived }
  | { kind: 'tradeResponse'; accept: boolean; margin: number | null; reason: string; derived: Derived }
  | { kind: 'produce'; gains: Record<string, Cards> }
  | { error: string }
