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
  // The ore/wheat/sheep cost buys no building, so it is the one recipe sheep
  // gates on its own (SIM-GAP-36). Ships at 0 until an A/B prices it.
  recipeDevCardBonus: number
  recipeCap: number
  portWeight: number
  genericPortFactor: number
  // A port only converts *surplus*: pips at or below this in the matching
  // resource earn no port credit, so sitting on a port with weak production
  // (and a sacrificed hex) no longer outranks real production.
  portSurplusThreshold: number
  // How much the *other* four resources' shortfall raises a port's credit. A
  // port is for converting a narrow spread, and portSurplusThreshold gates on
  // the ported resource alone (SIM-GAP-37). Ships at 0, where every port
  // factor is exactly 1 and the port delta is unchanged.
  portCoverageDeficitWeight: number
  // How many road-builds away a port still counts. A strong inland spot can
  // build toward a port by mid-game, which beats sitting on it and forfeiting
  // a hex; reach decays per road so on-port access still ranks highest.
  nearPortRadius: number
  nearPortDecay: number
  // What the best sites a candidate *opens* are worth to it. A pair that is
  // boxed in by rivals converts its pips into nothing, and every other
  // component prices only the two vertices themselves. Ships at 0 until an A/B
  // prices it, where the walk is skipped and the term is exactly 0.
  expansionWeight: number
  // Per paid road-build discount on a site's value. The first road is the free
  // setup one, so a site two builds out is worth `decay ** 2` of its score. At
  // 1 distance stops mattering; inert while expansionWeight is 0.
  expansionDecay: number
  robberDiscount: number
  // How much piling pips onto one hex costs. `robberDiscount` prices only the
  // hex the robber sits on today; this prices the standing exposure of a pair
  // whose income is concentrated on a single blockable hex, measured as the
  // move in that hex's share of the pair's pips. Ships at 0, where the share is
  // never computed and the robber component is exactly what it was.
  robberConcentrationWeight: number
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
  recipeDevCardBonus: 0,
  // Matches diversityCap so "real coverage" means one thing everywhere: at a
  // lower cap a lone 2/12 cleared a larger fraction of the recipe bar and a
  // never-rolled fifth resource still bought most of a recipe bonus.
  recipeCap: 4,
  portWeight: 0.55,
  genericPortFactor: 0.5,
  portSurplusThreshold: 3,
  portCoverageDeficitWeight: 0,
  nearPortRadius: 2,
  nearPortDecay: 0.5,
  expansionWeight: 0,
  expansionDecay: 0.5,
  robberDiscount: 0.35,
  robberConcentrationWeight: 0,
  opponentTopK: 3,
  softmaxTemperature: 1.25,
  rolloutBudget: 500_000,
  rolloutsMin: 4,
  rolloutsMax: 24,
  maxResults: 8,
}
