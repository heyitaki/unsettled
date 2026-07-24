export interface EngineWeights {
  scarcityWeight: number
  scarcityClampMin: number
  scarcityClampMax: number
  diversityWeight: number
  diversityCap: number
  duplicateNumberPenalty: number
  recipeRoadBonus: number
  recipeCityBonus: number
  recipeSettlementBonus: number
  recipeCap: number
  portWeight: number
  genericPortFactor: number
  robberDiscount: number
  opponentTopK: number
  softmaxTemperature: number
  rolloutBudget: number
  rolloutsMin: number
  rolloutsMax: number
  maxResults: number
}

export const DEFAULT_WEIGHTS: EngineWeights = {
  scarcityWeight: 0.35,
  scarcityClampMin: 0.5,
  scarcityClampMax: 2,
  diversityWeight: 1.6,
  diversityCap: 4,
  duplicateNumberPenalty: 0.08,
  recipeRoadBonus: 1.5,
  recipeCityBonus: 2,
  recipeSettlementBonus: 1,
  recipeCap: 3,
  portWeight: 0.55,
  genericPortFactor: 0.5,
  robberDiscount: 0.35,
  opponentTopK: 3,
  softmaxTemperature: 1.25,
  rolloutBudget: 500_000,
  rolloutsMin: 4,
  rolloutsMax: 24,
  maxResults: 8,
}
