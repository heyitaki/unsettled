import {
  addPlayer,
  createBoard,
  pips,
  placeBuilding,
  placeRoad,
  setHexTile,
  setNumberToken,
  setRobber,
  upsertPort,
  vertexProduction,
} from '../../src/model/board.ts'
import { vertexAdjacency } from '../../src/engine/legality.ts'
import {
  addToHoldings,
  breakdownTotal,
  computeBoardContext,
  emptyHoldings,
  marginalBreakdown,
  marginalTotal,
  occupancyFromBoard,
  type DraftSlot,
} from '../../src/engine/valuation.ts'
import {
  DEFAULT_WEIGHTS,
  neutralSlotScales,
  type EngineWeights,
  type SlotScale,
  type SlotScales,
} from '../../src/engine/weights.ts'
import {
  axialKey,
  edgeEndpointVertexIds,
  hexVertexIds,
  vertexAdjacentVertexIds,
  vertexIncidentEdgeIds,
  vertexTouchingHexes,
} from '../../src/model/coords.ts'
import { boardGrid } from '../../src/model/layouts.ts'
import { parseBoard } from '../../src/model/serialization.ts'
import {
  PLAYER_PALETTE,
  RESOURCES,
  type Board,
  type LayoutId,
  type Resource,
  type VertexId,
} from '../../src/model/types.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface CaseInput {
  id: string
  covers: string[]
  board: Board
  weights?: EngineWeights
  holdings?: VertexId[]
  candidate: VertexId
  receivesGrant?: boolean
  /** The draft slot the case is scored at, or absent for an unscaled score. */
  slot?: DraftSlot
  ingestion?: {
    outcome: 'reject'
    error: 'NullTile' | 'MissingToken' | 'NoRobberPlacement'
  }
  degenerate?: boolean
}

const here = dirname(fileURLToPath(import.meta.url))
const simulatorDir = resolve(here, '..')
const repoDir = resolve(simulatorDir, '..')
const fixtureDir = resolve(simulatorDir, 'fixtures')
const weightsDir = resolve(simulatorDir, 'placement')

const cloneWeights = (changes: Partial<EngineWeights> = {}): EngineWeights => ({
  ...DEFAULT_WEIGHTS,
  resourceValue: { ...DEFAULT_WEIGHTS.resourceValue },
  slotScales: neutralSlotScales(),
  ...changes,
})

/** The shipped block with one (seat count, slot) entry moved, which is all a case ever needs. */
const scaledSlot = (slot: DraftSlot, scale: SlotScale): SlotScales => {
  const scales = neutralSlotScales()
  scales[String(slot.seats)][String(slot.slot)] = scale
  return scales
}

function completeBoard(layout: LayoutId, absent?: Resource): Board {
  const grid = boardGrid(layout)
  const resources = RESOURCES.filter((resource) => resource !== absent)
  const tokens = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
  let board = createBoard(layout)
  for (let index = 0; index < grid.landCoords.length; index += 1) {
    const coord = grid.landCoords[index]
    const desert = index === grid.landCoords.length - 1
    board = setHexTile(board, coord, desert ? 'desert' : resources[index % resources.length])
    board = setNumberToken(board, coord, desert ? null : tokens[index % tokens.length])
  }
  board = setRobber(board, grid.landCoords[grid.landCoords.length - 1])
  const seats = layout === 'standard4' ? 4 : 5
  for (let index = 1; index < seats; index += 1) {
    const colors = Object.values(PLAYER_PALETTE)
    board = addPlayer(board, {
      id: `p${index + 1}`,
      name: `P${index + 1}`,
      color: colors[index],
    })
  }
  return board
}

const vertexWithHexCount = (board: Board, count: number): VertexId => {
  const land = boardGrid(board.layout).landKeys
  const vertex = boardGrid(board.layout).vertexIds.find((candidate) =>
    vertexTouchingHexes(candidate).filter((coord) => land.has(axialKey(coord))).length === count)
  if (!vertex) throw new Error(`No ${count}-hex vertex on ${board.layout}`)
  return vertex
}

const interiorVertex = (board: Board): VertexId => {
  const coastal = new Set(boardGrid(board.layout).coastalEdgeIds.flatMap(edgeEndpointVertexIds))
  const vertex = boardGrid(board.layout).vertexIds.find((candidate) => !coastal.has(candidate))
  if (!vertex) throw new Error(`No interior vertex on ${board.layout}`)
  return vertex
}

function singleResourceBoard(resource: Resource): Board {
  let board = completeBoard('standard4')
  for (const hex of board.hexes) {
    if (hex.tile !== 'desert') board = setHexTile(board, hex.coord, resource)
  }
  return board
}

function readBoardFixture(name: string): Board {
  const parsed = parseBoard(readFileSync(
    resolve(repoDir, 'src/parser/__tests__/expected', name),
    'utf8',
  ))
  if (!parsed.ok) throw new Error(`Invalid board fixture ${name}: ${parsed.errors.join(', ')}`)
  return parsed.board
}

function holdingsCoveringAllResources(board: Board): VertexId[] {
  const covered = new Set<Resource>()
  const holdings: VertexId[] = []
  for (const vertex of boardGrid(board.layout).vertexIds) {
    const production = vertexProduction(board, vertex)
    if (!RESOURCES.some((resource) => production[resource] && !covered.has(resource))) continue
    holdings.push(vertex)
    for (const resource of RESOURCES) if (production[resource]) covered.add(resource)
    if (covered.size === RESOURCES.length) return holdings
  }
  throw new Error('Board does not expose all five resources')
}

/**
 * A case scores one seat's candidate with the case board's own pieces standing around it.
 *
 * The seat is whoever owns the case's first holding, so that player's roads on the board are the
 * seat's own roads, and a seat of its own when the case has no holdings or its first holding sits
 * on an empty vertex. `holdings` is the seat's whole holding either way: any *other* building the
 * board records for that player stays occupied without joining it, which on the Rust side means a
 * spare seat owns it. `placement_parity.rs::case_occupancy` is the mirror of this rule.
 */
function scoreCase(input: CaseInput) {
  const weights = input.weights ?? cloneWeights()
  const ctx = computeBoardContext(input.board, weights)
  const first = input.holdings?.[0]
  const seat = input.board.buildings.find((building) => building.vertexId === first)?.playerId
  const occupancy = occupancyFromBoard(input.board, seat ?? null)
  const holdings = (input.holdings ?? []).reduce(
    (held, vertex) => addToHoldings(ctx, held, vertex),
    emptyHoldings(),
  )
  const hand = input.receivesGrant
    ? ctx.stats.get(input.candidate)?.setupGrant ?? null
    : null
  const slot = input.slot ?? null
  const components = marginalBreakdown(ctx, holdings, input.candidate, hand, occupancy, slot)
  return {
    id: input.id,
    covers: input.covers,
    board: input.board,
    weights,
    holdings: input.holdings ?? [],
    candidate: input.candidate,
    receivesGrant: input.receivesGrant ?? false,
    slot,
    components,
    marginalTotal: marginalTotal(ctx, holdings, input.candidate, hand, occupancy, slot),
    breakdownTotal: breakdownTotal(components),
    ingestion: input.ingestion ?? { outcome: 'score' as const },
    degenerate: input.degenerate ?? false,
  }
}

const standard = completeBoard('standard4')
const extension = completeBoard('extension6')
const oneHex = vertexWithHexCount(standard, 1)
const twoHex = vertexWithHexCount(standard, 2)
const threeHex = vertexWithHexCount(standard, 3)
const firstPortEdge = boardGrid('standard4').coastalEdgeIds[0]
const [firstPortA, firstPortB] = edgeEndpointVertexIds(firstPortEdge)
const offPortNeighbor = vertexAdjacentVertexIds(firstPortA).find(
  (vertex) => vertex !== firstPortB && boardGrid('standard4').vertexIds.includes(vertex),
)
if (!offPortNeighbor) throw new Error('Port endpoint has no inland neighbor')
const robbedCoord = vertexTouchingHexes(threeHex).find((coord) =>
  boardGrid('standard4').landKeys.has(axialKey(coord)))
if (!robbedCoord) throw new Error('Robbed candidate does not touch land')
const robbedBoard = setRobber(standard, robbedCoord)
const desertCoord = standard.hexes.find((hex) => hex.tile === 'desert')?.coord
if (!desertCoord) throw new Error('Programmatic board has no desert')
const desertVertex = hexVertexIds(desertCoord).find((vertex) =>
  Object.values(vertexProduction(standard, vertex)).some((amount) => (amount ?? 0) > 0))
if (!desertVertex) throw new Error('Desert has no resource-producing adjacent vertex')
const repeatedTokenVertices = hexVertexIds(standard.hexes[0].coord)
const noPorts = { ...standard, ports: [] }
const singlePort = { ...standard, ports: [] }
const genericPort = upsertPort(singlePort, firstPortEdge, null, 3)
const dedicatedPort = upsertPort(singlePort, firstPortEdge, 'wood', 2)
const saturatedPort = upsertPort(singlePort, firstPortEdge, 'wood', 2 ** 32)
const sharedPortBoard = upsertPort(
  { ...singleResourceBoard('wood'), ports: [] },
  firstPortEdge,
  'wood',
  2,
)
const comparisonGenericEdge = boardGrid('standard4').coastalEdgeIds[0]
const comparisonDedicatedEdge =
  boardGrid('standard4').coastalEdgeIds[Math.floor(boardGrid('standard4').coastalEdgeIds.length / 2)]
const comparisonHolding = edgeEndpointVertexIds(comparisonGenericEdge)[0]
const comparisonCandidate = edgeEndpointVertexIds(comparisonDedicatedEdge)[0]
const nullRobber = setRobber(standard, null)
const noDesertNullRobber = setRobber(
  setNumberToken(setHexTile(standard, desertCoord, 'wood'), desertCoord, 6),
  null,
)
const absentOre = completeBoard('standard4', 'ore')
const nullTile = setHexTile(standard, standard.hexes[0].coord, null)
const nullToken = setNumberToken(standard, standard.hexes[0].coord, null)
// The dev-card recipe is the one term gated on ore, wheat and sheep together, and
// no programmatic board hands out a vertex touching all three, so build one: three
// land hexes clear of the desert, at distinct tokens so sheep stays below recipeCap
// and the min the term takes is a fraction rather than a saturated 1.
const standardGrid = boardGrid('standard4')
const landHexesOf = (vertex: VertexId) =>
  vertexTouchingHexes(vertex).filter((coord) => standardGrid.landKeys.has(axialKey(coord)))
const devCardVertex = standardGrid.vertexIds.find((candidate) => {
  const hexes = landHexesOf(candidate)
  return hexes.length === 3 &&
    !hexes.some((coord) => axialKey(coord) === axialKey(desertCoord))
})
if (!devCardVertex) throw new Error('No three-hex vertex clear of the desert')
const devCardBoard = ([['ore', 8], ['wheat', 5], ['sheep', 10]] as const).reduce(
  (board, [resource, token], index) => {
    const coord = landHexesOf(devCardVertex)[index]
    return setNumberToken(setHexTile(board, coord, resource), coord, token)
  },
  standard,
)

// The coverage-deficit port factor needs a pair that actually has surplus in the
// ported resource *and* a spread that moves when the candidate is added, so the
// pre-move and post-move deficits differ and the term is exercised as a delta.
// completeBoard's rotation gives the port endpoints neither, so force both land
// hexes under the port to wood at 6 (5 pips each, well past portSurplusThreshold)
// and take the inland neighbour, which brings its own resources with it.
const portDeficitBoard = landHexesOf(firstPortA).reduce(
  (board, coord) => setNumberToken(setHexTile(board, coord, 'wood'), coord, 6),
  dedicatedPort,
)

// SP3's expansion walk. The candidate is an interior vertex whose three neighbours are interior
// too, so every direction out of it is open board and each piece below closes exactly one of them:
// the seat's own road makes its direction free to travel and keeps the free setup road in hand,
// two rival settlements make the second direction a dead end, and a rival road closes the third
// outright. `expansionBlockedBoard` is the same board with the seat's road in a rival's name, so
// the last open path shuts and the candidate opens nothing at all.
const standardAdjacency = vertexAdjacency('standard4')
const standardCoastalVertices = new Set(standardGrid.coastalEdgeIds.flatMap(edgeEndpointVertexIds))
const expansionCandidate = standardGrid.vertexIds.find((vertex) =>
  !standardCoastalVertices.has(vertex) &&
  (standardAdjacency.get(vertex) ?? []).every((neighbor) => !standardCoastalVertices.has(neighbor)))
if (!expansionCandidate) throw new Error('No interior vertex whose neighbours are all interior')
const expansionEdges = vertexIncidentEdgeIds(expansionCandidate)
  .filter((edgeId) => standardGrid.edgeIds.includes(edgeId))
if (expansionEdges.length !== 3) throw new Error('Interior vertex must sit on three edges')
const [ownRoadEdge, boxedEdge, rivalRoadEdge] = expansionEdges
const boxedNeighbor = edgeEndpointVertexIds(boxedEdge)
  .find((vertex) => vertex !== expansionCandidate)
if (!boxedNeighbor) throw new Error('Boxed edge has no far endpoint')
// The far endpoint's own two neighbours, which are the whole of that direction beyond it. They are
// two steps apart, so a settlement on each is legal.
const boxedSettlements = (standardAdjacency.get(boxedNeighbor) ?? [])
  .filter((vertex) => vertex !== expansionCandidate)
const expansionDistances = new Map<VertexId, number>([[expansionCandidate, 0]])
const expansionQueue: VertexId[] = [expansionCandidate]
for (let head = 0; head < expansionQueue.length; head += 1) {
  const vertex = expansionQueue[head]
  for (const neighbor of standardAdjacency.get(vertex) ?? []) {
    if (expansionDistances.has(neighbor)) continue
    expansionDistances.set(neighbor, (expansionDistances.get(vertex) ?? 0) + 1)
    expansionQueue.push(neighbor)
  }
}
// Far enough out that the seat's own settlement prices the sites without being one of them.
const expansionHolding = standardGrid.vertexIds.find((vertex) =>
  (expansionDistances.get(vertex) ?? 0) >= 5 &&
  boxedSettlements.every((settled) => !(standardAdjacency.get(vertex) ?? []).includes(settled)))
if (!expansionHolding) throw new Error('No vertex far enough from the expansion candidate')
const expansionPieces = boxedSettlements.reduce(
  (board, vertexId) => placeBuilding(board, vertexId, 'p2', 'settlement'),
  placeBuilding(standard, expansionHolding, 'aki', 'settlement'),
)
const expansionBoard = placeRoad(placeRoad(expansionPieces, rivalRoadEdge, 'p3'), ownRoadEdge, 'aki')
const expansionBlockedBoard = placeRoad(
  placeRoad(expansionPieces, rivalRoadEdge, 'p3'),
  ownRoadEdge,
  'p2',
)

// The robber concentration term. Its share is over the *distinct* producing hexes a pair touches,
// so the case that pins it is one where the candidate brings a hex the holding already has: a hex
// counted twice would move the share the wrong way, and both scorers dedupe it through different
// machinery (a keyed map on one side, a bitmask on the other). Both pairs are three-hex vertices,
// so both are interior, which is why a one-hex overlap cannot come from adjacency.
const producingHexKeys = (vertex: VertexId): string[] =>
  landHexesOf(vertex)
    .map(axialKey)
    .filter((key) => {
      const hex = standard.hexes.find((entry) => axialKey(entry.coord) === key)
      return hex !== undefined && hex.tile !== null && hex.tile !== 'desert' &&
        pips(hex.numberToken) > 0
    })

const topHexShare = (vertices: VertexId[]): number => {
  const hexes = new Map<string, number>()
  for (const vertex of vertices) {
    for (const key of producingHexKeys(vertex)) {
      const hex = standard.hexes.find((entry) => axialKey(entry.coord) === key)
      if (hex) hexes.set(key, pips(hex.numberToken))
    }
  }
  const amounts = [...hexes.values()]
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  return total === 0 ? 0 : Math.max(...amounts) / total
}

// The first pair of three-hex vertices overlapping in exactly `shared` hexes whose top-hex share
// actually moves when the candidate joins, so the case cannot silently pin a delta of 0.
function concentrationPair(shared: number): [VertexId, VertexId] {
  for (const holding of standardGrid.vertexIds) {
    const held = producingHexKeys(holding)
    if (held.length !== 3) continue
    for (const candidate of standardGrid.vertexIds) {
      if (candidate === holding) continue
      const keys = producingHexKeys(candidate)
      if (keys.length !== 3) continue
      if (keys.filter((key) => held.includes(key)).length !== shared) continue
      if (topHexShare([holding, candidate]) === topHexShare([holding])) continue
      return [holding, candidate]
    }
  }
  throw new Error(`No three-hex pair sharing ${shared} hexes moves the top-hex share`)
}

const [concentrationHolding, concentrationCandidate] = concentrationPair(0)
const [sharedHexHolding, sharedHexCandidate] = concentrationPair(1)

const draftEmpty = readBoardFixture('board-draft-empty.json')
const endgame = readBoardFixture('board-endgame-pieces.json')

const cases: CaseInput[] = [
  {
    id: 'standard-empty-three-hex',
    covers: ['B7', 'B10', 'H1', 'G1'],
    board: standard,
    candidate: threeHex,
    receivesGrant: true,
  },
  {
    id: 'standard-empty-three-hex-no-grant',
    covers: ['G2'],
    board: standard,
    candidate: threeHex,
  },
  ...RESOURCES.map((resource): CaseInput => {
    const base = singleResourceBoard(resource)
    const generic = upsertPort({ ...base, ports: [] }, comparisonGenericEdge, null, 3)
    const board = upsertPort(generic, comparisonDedicatedEdge, resource, 2)
    return {
      id: `port-max-${resource}`,
      covers: resource === 'wood' ? ['P3'] : [],
      board,
      holdings: [comparisonHolding],
      candidate: comparisonCandidate,
    }
  }),
  {
    id: 'one-hex-null-robber',
    covers: ['B1', 'B5'],
    board: nullRobber,
    candidate: oneHex,
  },
  {
    id: 'no-desert-null-robber-rejected',
    covers: ['B11'],
    board: noDesertNullRobber,
    candidate: desertVertex,
    ingestion: { outcome: 'reject', error: 'NoRobberPlacement' },
  },
  {
    id: 'two-hex-vertex',
    covers: ['B6'],
    board: standard,
    candidate: twoHex,
  },
  {
    id: 'desert-touching-vertex',
    covers: ['B2', 'G3'],
    board: standard,
    candidate: desertVertex,
    receivesGrant: true,
  },
  {
    id: 'null-tile-rejected',
    covers: ['B3'],
    board: nullTile,
    candidate: threeHex,
    ingestion: { outcome: 'reject', error: 'NullTile' },
  },
  {
    id: 'null-token-rejected',
    covers: ['B4'],
    board: nullToken,
    candidate: threeHex,
    ingestion: { outcome: 'reject', error: 'MissingToken' },
  },
  {
    id: 'absent-resource',
    covers: ['B8'],
    board: absentOre,
    candidate: threeHex,
  },
  {
    id: 'extension-programmatic',
    covers: ['B9'],
    board: extension,
    candidate: vertexWithHexCount(extension, 3),
  },
  {
    id: 'extension-granted-hand',
    covers: ['G5'],
    board: extension,
    // The one grant case on a nonzero handValueWeight. DEFAULT_WEIGHTS ships the
    // term at 0 since the M-43 drop, so without an explicit witness here the
    // whole hand-value path would leave the parity fixture uncovered.
    weights: cloneWeights({ handValueWeight: 0.4 }),
    candidate: vertexWithHexCount(extension, 3),
    receivesGrant: true,
  },
  {
    id: 'nonfinite-radius',
    covers: ['W1'],
    board: genericPort,
    weights: cloneWeights({ nearPortRadius: Number.POSITIVE_INFINITY }),
    candidate: offPortNeighbor,
  },
  {
    id: 'nonfinite-decay',
    covers: ['W2'],
    board: genericPort,
    weights: cloneWeights({ nearPortDecay: Number.POSITIVE_INFINITY }),
    candidate: offPortNeighbor,
  },
  {
    id: 'negative-fractional-coverage-base',
    covers: ['W3'],
    board: robbedBoard,
    weights: cloneWeights({ robberDiscount: 2 }),
    holdings: [threeHex],
    candidate: threeHex,
  },
  {
    id: 'zero-diversity-cap',
    covers: ['W4'],
    board: standard,
    weights: cloneWeights({ diversityCap: 0 }),
    candidate: threeHex,
    degenerate: true,
  },
  {
    id: 'zero-recipe-cap',
    covers: ['W5'],
    board: standard,
    weights: cloneWeights({ diversityCap: 3, recipeCap: 0 }),
    candidate: threeHex,
    degenerate: true,
  },
  {
    id: 'zero-decay-on-port',
    covers: ['W6'],
    board: dedicatedPort,
    weights: cloneWeights({ nearPortDecay: 0 }),
    candidate: firstPortA,
  },
  {
    id: 'unit-decay-generic-port',
    covers: ['W7', 'P2'],
    board: genericPort,
    weights: cloneWeights({ nearPortDecay: 1 }),
    candidate: firstPortA,
  },
  {
    id: 'surplus-threshold-high',
    covers: ['W8'],
    board: dedicatedPort,
    weights: cloneWeights({ portSurplusThreshold: 1_000 }),
    candidate: firstPortA,
  },
  {
    id: 'zero-resource-values',
    covers: ['W9'],
    board: standard,
    weights: cloneWeights({
      resourceValue: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 },
    }),
    candidate: threeHex,
  },
  {
    id: 'zero-hand-value-weight',
    covers: ['G4'],
    board: standard,
    weights: cloneWeights({ handValueWeight: 0 }),
    candidate: threeHex,
    receivesGrant: true,
  },
  {
    id: 'different-coverage-caps',
    covers: ['W10'],
    board: standard,
    weights: cloneWeights({ diversityCap: 10, recipeCap: 2 }),
    candidate: threeHex,
  },
  {
    id: 'saturated-dedicated-port',
    covers: ['P1'],
    board: saturatedPort,
    candidate: firstPortA,
  },
  {
    id: 'same-port-two-accesses',
    covers: ['P4', 'H4'],
    board: sharedPortBoard,
    holdings: [firstPortA],
    candidate: firstPortB,
  },
  {
    id: 'no-port-vertex',
    covers: ['P5'],
    board: noPorts,
    candidate: interiorVertex(noPorts),
  },
  {
    id: 'all-resources-held',
    covers: ['H2'],
    board: standard,
    holdings: holdingsCoveringAllResources(standard),
    candidate: threeHex,
  },
  {
    id: 'duplicate-number',
    covers: ['H3'],
    board: standard,
    holdings: [repeatedTokenVertices[0]],
    candidate: repeatedTokenVertices[1],
  },
  {
    id: 'real-draft-empty',
    covers: ['F1'],
    board: draftEmpty,
    holdings: [],
    candidate: boardGrid(draftEmpty.layout).vertexIds[20],
  },
  {
    id: 'real-draft-empty-granted',
    covers: ['G6'],
    board: draftEmpty,
    holdings: [],
    candidate: boardGrid(draftEmpty.layout).vertexIds[20],
    receivesGrant: true,
  },
  {
    id: 'dev-card-recipe',
    covers: ['W11'],
    board: devCardBoard,
    weights: cloneWeights({ recipeDevCardBonus: 2 }),
    candidate: devCardVertex,
  },
  {
    id: 'port-coverage-deficit',
    covers: ['W12'],
    board: portDeficitBoard,
    weights: cloneWeights({ portCoverageDeficitWeight: 1 }),
    holdings: [firstPortA],
    candidate: offPortNeighbor,
  },
  {
    id: 'expansion-sites',
    covers: ['W13'],
    board: expansionBoard,
    // The shipped weight is 0 and skips the walk, so without a witness value here the whole term
    // would leave the parity fixture uncovered. 0.3 is SP3's high arm.
    weights: cloneWeights({ expansionWeight: 0.3 }),
    holdings: [expansionHolding],
    candidate: expansionCandidate,
  },
  {
    id: 'expansion-blocked',
    covers: ['W13'],
    board: expansionBlockedBoard,
    weights: cloneWeights({ expansionWeight: 0.3 }),
    holdings: [expansionHolding],
    candidate: expansionCandidate,
  },
  {
    id: 'robber-concentration',
    covers: ['W14'],
    board: standard,
    // The shipped weight is 0 and takes no share at all, so without a witness value here the term
    // would leave the parity fixture uncovered. 4.0 is the arm M-57 measures.
    weights: cloneWeights({ robberConcentrationWeight: 4 }),
    holdings: [concentrationHolding],
    candidate: concentrationCandidate,
  },
  {
    id: 'robber-concentration-shared-hex',
    covers: ['W14'],
    board: standard,
    weights: cloneWeights({ robberConcentrationWeight: 4 }),
    holdings: [sharedHexHolding],
    candidate: sharedHexCandidate,
  },
  {
    // SP4's slot scales. `expansion-sites` is the same board, holding, candidate and expansion
    // weight, so the two cases differ only in the scale, and the fixture pins the scaled
    // components against the unscaled ones on both sides at once. The seat is `aki`, whose index
    // in the board's four players is slot 0, which is the entry the scale moves.
    id: 'slot-scales',
    covers: ['W15'],
    board: expansionBoard,
    weights: cloneWeights({
      expansionWeight: 0.3,
      slotScales: scaledSlot(
        { seats: 4, slot: 0 },
        { expansion: 2, diversity: 0.5 },
      ),
    }),
    holdings: [expansionHolding],
    candidate: expansionCandidate,
    slot: { seats: 4, slot: 0 },
  },
  {
    id: 'real-endgame-pieces',
    covers: ['F2'],
    board: endgame,
    holdings: holdingsCoveringAllResources(endgame),
    candidate: boardGrid(endgame.layout).vertexIds[40],
  },
]

const encodeNonFinite = (_key: string, value: unknown): unknown => {
  if (typeof value !== 'number' || Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

const pack = {
  version: 1,
  cases: cases.map(scoreCase),
}

mkdirSync(fixtureDir, { recursive: true })
mkdirSync(weightsDir, { recursive: true })
writeFileSync(
  resolve(fixtureDir, 'placement-parity.json'),
  `${JSON.stringify(pack, encodeNonFinite, 2)}\n`,
)
writeFileSync(
  resolve(weightsDir, 'default-weights.json'),
  `${JSON.stringify(DEFAULT_WEIGHTS, null, 2)}\n`,
)
