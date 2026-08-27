import type { Resource } from '../model/types'

export interface EngineWeights {
  // Intrinsic worth of a pip by resource, normalized so the five average ~1.0.
  // Wheat/ore dominate win paths; sheep is least-consumed. See MEMORY roadmap.
  resourceValue: Record<Resource, number>
  // Cards held immediately after the action, priced through resourceValue.
  handValueWeight: number
  scarcityWeight: number
  scarcityClampMin: number
  scarcityClampMax: number
  diversityWeight: number
  diversityCap: number
  // Curvature of coverage credit: exponent > 1 makes a lone 2/12 (1 pip)
  // token count for far less than its linear share, so "exposure" only earns
  // real credit once a resource actually rolls (>=3 pips).
  coverageExponent: number
  // How much board supply changes the cost of *missing* a resource. Skipping a
  // resource the board is flush with is cheap (someone will trade it away);
  // skipping a scarce one strands you. 0 makes the drop decision board-blind.
  coverageScarcityWeight: number
  duplicateNumberPenalty: number
  recipeRoadBonus: number
  recipeCityBonus: number
  recipeSettlementBonus: number
  recipeCap: number
  portWeight: number
  genericPortFactor: number
  // A port only converts *surplus*: pips at or below this in the matching
  // resource earn no port credit, so sitting on a port with weak production
  // (and a sacrificed hex) no longer outranks real production.
  portSurplusThreshold: number
  // How many road-builds away a port still counts. A strong inland spot can
  // build toward a port by mid-game, which beats sitting on it and forfeiting
  // a hex; reach decays per road so on-port access still ranks highest.
  nearPortRadius: number
  nearPortDecay: number
  robberDiscount: number
  opponentTopK: number
  softmaxTemperature: number
  rolloutBudget: number
  rolloutsMin: number
  rolloutsMax: number
  maxResults: number
}

export const DEFAULT_WEIGHTS: EngineWeights = {
  resourceValue: { wheat: 1.35, ore: 1.3, wood: 0.8, brick: 0.8, sheep: 0.75 },
  // Dropped at Phase I (M-43/M-46): under competent play the setup grant's
  // value is realized in-game, so the placement-time term double counts; the
  // measured unique value of keeping it was ~0.13pp. The term code stays.
  handValueWeight: 0,
  scarcityWeight: 0.35,
  scarcityClampMin: 0.5,
  scarcityClampMax: 2,
  diversityWeight: 1.6,
  diversityCap: 4,
  coverageExponent: 1.5,
  coverageScarcityWeight: 0.5,
  duplicateNumberPenalty: 0.08,
  recipeRoadBonus: 1.5,
  recipeCityBonus: 2,
  recipeSettlementBonus: 1,
  // Matches diversityCap so "real coverage" means one thing everywhere: at a
  // lower cap a lone 2/12 cleared a larger fraction of the recipe bar and a
  // never-rolled fifth resource still bought most of a recipe bonus.
  recipeCap: 4,
  portWeight: 0.55,
  genericPortFactor: 0.5,
  portSurplusThreshold: 3,
  nearPortRadius: 2,
  nearPortDecay: 0.5,
  robberDiscount: 0.35,
  opponentTopK: 3,
  softmaxTemperature: 1.25,
  rolloutBudget: 500_000,
  rolloutsMin: 4,
  rolloutsMax: 24,
  maxResults: 8,
}
