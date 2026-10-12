import { analyzeBoard, PAIR_TIE, type DraftAnalysis } from '../../src/engine/analyze.ts'
import {
  blockedVertices,
  legalSettlementVertices,
  vertexAdjacency,
} from '../../src/engine/legality.ts'
import { mulberry32 } from '../../src/engine/random.ts'
import { weightsForSeats, type EngineWeights } from '../../src/engine/weights.ts'
import {
  addPlayer,
  createBoard,
  draftOrder,
  pips,
  placeBuilding,
  placeRoad,
  randomizeBoard,
  setHexTile,
  setMe,
  setNumberToken,
  setRobber,
  upsertPort,
  vertexProduction,
} from '../../src/model/board.ts'
import { hexVertexIds, vertexIncidentEdgeIds } from '../../src/model/coords.ts'
import { boardGrid } from '../../src/model/layouts.ts'
import { PLAYER_PALETTE, type Board, type EdgeId, type LayoutId, type VertexId } from '../../src/model/types.ts'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface CaseOptions {
  seed?: number
  rollouts?: number
  maxResults?: number
  weights?: EngineWeights
}

interface CaseInput {
  name: string
  board: Board
  targetPick?: number
  options?: CaseOptions
  /** What makes the case its class. The generator throws when it stops holding. */
  holds: (analysis: DraftAnalysis, board: Board) => boolean
  /** The same, asked of the pair gaps the analysis compared: see `recordingPairGaps`. */
  pairGaps?: (gaps: readonly number[]) => boolean
}

const here = dirname(fileURLToPath(import.meta.url))
const MULBERRY_SEEDS = [7, 12345]

/** `randomizeBoard` with `Math.random` swapped for a seeded generator, so the map is reproducible. */
function seededMap(board: Board, seed: number): Board {
  const original = Math.random
  Math.random = mulberry32(seed)
  try {
    return randomizeBoard(board)
  } finally {
    Math.random = original
  }
}

/** A legal map of the layout with `seats` players, `aki` first and claimed. */
function mapWithSeats(layout: LayoutId, seats: number, seed: number): Board {
  const colors = Object.values(PLAYER_PALETTE)
  let board = createBoard(layout)
  for (let index = 1; index < seats; index += 1) {
    board = addPlayer(board, { id: `p${index + 1}`, name: `P${index + 1}`, color: colors[index] })
  }
  return seededMap(board, seed)
}

/** The vertex's edges that are on the board: a coastal vertex has edges running out to sea. */
const incidentEdges = (layout: LayoutId, vertexId: VertexId): EdgeId[] => {
  const gridEdges = new Set(boardGrid(layout).edgeIds)
  return vertexIncidentEdgeIds(vertexId).filter((edgeId) => gridEdges.has(edgeId))
}

const pipTotal = (board: Board, vertexId: VertexId): number =>
  Object.values(vertexProduction(board, vertexId)).reduce((sum, amount) => sum + amount, 0)

/**
 * The first `count` picks of the snake, placed as a table would: each on one of the six legal
 * vertices with the most pips, chosen by a seeded generator, with a road on one of its edges.
 */
function drafted(board: Board, count: number, seed = 1): Board {
  const random = mulberry32(seed)
  const order = draftOrder(board)
  let next = board
  for (let turn = 0; turn < count; turn += 1) {
    const playerId = order[turn]
    const best = legalSettlementVertices(next)
      .map((vertexId) => ({ vertexId, pips: pipTotal(next, vertexId) }))
      .sort((a, b) => b.pips - a.pips)
      .slice(0, 6)
    const { vertexId } = best[Math.floor(random() * best.length)]
    const edges = incidentEdges(next.layout, vertexId)
    next = placeBuilding(next, vertexId, playerId, 'settlement')
    next = placeRoad(next, edges[Math.floor(random() * edges.length)], playerId)
  }
  return next
}

/**
 * `worstCaseBoard()` of `src/engine/__tests__/perf.test.ts`, which does not export it: six seats
 * on the extension board, every hex producing, the robber on the first. Its ports come from
 * `randomizeBoard`, seeded here so the case is the same board on every run.
 */
function worstCaseBoard(): Board {
  let board = createBoard('extension6')
  for (let index = 2; index <= 6; index += 1) {
    board = addPlayer(board, { id: `p${index}`, name: `P${index}`, color: '#333333' })
  }
  board = seededMap(setMe(board, 'aki'), 1)
  const resources = ['wood', 'sheep', 'wheat', 'brick', 'ore'] as const
  const tokens = [5, 6, 8, 9, 10, 4, 11, 3] as const
  for (let index = 0; index < board.hexes.length; index += 1) {
    const { coord } = board.hexes[index]
    board = setHexTile(board, coord, resources[index % resources.length])
    board = setNumberToken(board, coord, tokens[index % tokens.length])
  }
  return setRobber(board, board.hexes[0].coord)
}

const withoutNumbers = (board: Board): Board =>
  board.hexes.reduce((next, hex) => setNumberToken(next, hex.coord, null), board)

/** Settlements laid on the first legal vertex, seat after seat, until no vertex is legal. */
function filled(board: Board): Board {
  let next = board
  for (;;) {
    const [vertexId] = legalSettlementVertices(next)
    if (vertexId === undefined) return next
    const { id } = next.players[next.buildings.length % next.players.length]
    next = placeBuilding(next, vertexId, id, 'settlement')
  }
}

/**
 * Three seats on a map whose one producing hex has aki and p2 on opposite corners, which bars all
 * six. No legal vertex has a pip, so p3, holding nothing, has no vertex worth a point, while the
 * wood port still pays p2 for the wood it already makes.
 */
function oneHexBoard(): Board {
  const centre = { q: 0, r: 0 }
  const corners = hexVertexIds(centre)
  let board = withoutNumbers(mapWithSeats('standard4', 3, 23))
  board = setNumberToken(setHexTile(board, centre, 'wood'), centre, 6)
  board = placeBuilding(board, corners[3], 'aki', 'settlement')
  board = placeBuilding(board, corners[0], 'p2', 'settlement')
  return upsertPort(board, boardGrid(board.layout).coastalEdgeIds[0], 'wood', 2)
}

/**
 * Runs `run` and collects every gap `opponentPick` compared against `PAIR_TIE`: one per candidate
 * whose best partner names it back, which is the mutual-mate rule firing. That comparison is the
 * function's only `Math.abs`, so the calls are read off it rather than re-deriving the scan here.
 */
function recordingPairGaps<T>(gaps: number[], run: () => T): T {
  const original = Math.abs
  Math.abs = (value: number): number => {
    if (new Error().stack?.includes('opponentPick')) gaps.push(value)
    return original(value)
  }
  try {
    return run()
  } finally {
    Math.abs = original
  }
}

const encodeNonFinite = (_key: string, value: unknown): unknown => {
  if (typeof value !== 'number' || Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

const text = (value: unknown): string => JSON.stringify(value, encodeNonFinite)

const analyze = (board: Board, targetPick?: number, options: CaseOptions = {}): DraftAnalysis =>
  analyzeBoard(board, { targetPick, ...options })

const ready = (analysis: DraftAnalysis): boolean =>
  analysis.status === 'ready' && analysis.recommendations.length > 0

/** Ready, with exactly these players picking ahead of the ranked pick, in this order. */
const readyBehind = (...pickers: string[]) => (analysis: DraftAnalysis): boolean =>
  ready(analysis) &&
  text(analysis.takenBeforeFirstPick.map(({ playerId }) => playerId)) === text(pickers)

/** Ready, with exactly these picks of mine still to come. */
const readyWithPicks = (...indices: number[]) => (analysis: DraftAnalysis): boolean =>
  ready(analysis) && text(analysis.draft.myRemainingPickIndices) === text(indices)

// Four seats pick in the order aki, p2, p3, p4, p4, p3, p2, aki.
const standard = mapWithSeats('standard4', 4, 11)
const extension = mapWithSeats('extension6', 6, 12)
const worstCase = worstCaseBoard()
const midFirstRound = setMe(drafted(standard, 2), 'p3')
const behindOne = setMe(standard, 'p2')
const seatWeights = weightsForSeats(4)
const adjacency = vertexAdjacency('standard4')
const producing = midFirstRound.hexes.filter((hex) => hex.numberToken !== null)
const oneHex = oneHexBoard()
// `midFirstRound` with a rival's road on every edge of the vertex it ranks first, so the expansion
// walk has no edge to leave that vertex by.
const walledIn = incidentEdges(
  'standard4',
  analyze(midFirstRound, undefined, { rollouts: 2 }).recommendations[0].firstPick,
).reduce((next, edgeId) => placeRoad(next, edgeId, 'p4'), midFirstRound)

const cases: CaseInput[] = [
  {
    name: 'empty-first-seat-standard4',
    board: standard,
    options: { rollouts: 3 },
    holds: (analysis, board) => board.layout === 'standard4' && board.players.length === 4 &&
      board.buildings.length === 0 && analysis.draft.currentPlayerId === board.mePlayerId &&
      readyBehind()(analysis),
  },
  {
    name: 'empty-first-seat-extension6',
    board: extension,
    options: { rollouts: 2 },
    holds: (analysis, board) => board.layout === 'extension6' && board.players.length === 6 &&
      board.buildings.length === 0 && analysis.draft.currentPlayerId === board.mePlayerId &&
      readyBehind()(analysis),
  },
  {
    name: 'roster-1',
    board: mapWithSeats('standard4', 1, 21),
    options: { rollouts: 3 },
    holds: (analysis, board) => board.players.length === 1 &&
      analysis.warnings.includes('solo-roster') && readyWithPicks(0, 1)(analysis),
  },
  {
    name: 'roster-2',
    board: setMe(mapWithSeats('standard4', 2, 22), 'p2'),
    options: { rollouts: 3 },
    holds: (analysis, board) => board.players.length === 2 && readyBehind('aki')(analysis),
  },
  {
    name: 'roster-3',
    board: setMe(drafted(mapWithSeats('standard4', 3, 23), 1), 'p3'),
    options: { rollouts: 3 },
    holds: (analysis, board) => board.players.length === 3 && readyBehind('p2')(analysis),
  },
  {
    name: 'roster-5',
    board: setMe(drafted(mapWithSeats('extension6', 5, 25), 3), 'p4'),
    options: { rollouts: 2 },
    holds: (analysis, board) => board.players.length === 5 && readyWithPicks(3, 6)(analysis),
  },
  {
    name: 'mid-first-round',
    board: midFirstRound,
    options: { rollouts: 3 },
    holds: (analysis) => analysis.draft.turnIndex === 2 && readyWithPicks(2, 5)(analysis),
  },
  {
    name: 'last-pick-of-round-one',
    board: setMe(drafted(standard, 3), 'p4'),
    options: { rollouts: 4 },
    holds: (analysis) => analysis.draft.turnIndex === 3 && readyWithPicks(3, 4)(analysis),
  },
  {
    name: 'first-pick-of-round-two',
    board: setMe(drafted(standard, 4), 'p4'),
    options: { rollouts: 4 },
    holds: (analysis) => analysis.draft.turnIndex === 4 && readyWithPicks(4)(analysis),
  },
  {
    name: 'mid-second-round',
    board: setMe(drafted(standard, 5), 'p2'),
    options: { rollouts: 3 },
    holds: (analysis) => analysis.draft.turnIndex === 5 && readyWithPicks(6)(analysis) &&
      readyBehind('p3')(analysis),
  },
  {
    name: 'last-pick',
    board: drafted(standard, 7),
    options: { rollouts: 4 },
    holds: (analysis) => analysis.draft.turnIndex === analysis.draft.sequence.length - 1 &&
      readyWithPicks(7)(analysis),
  },
  {
    name: 'max-results-2',
    board: drafted(standard, 7),
    options: { rollouts: 4, maxResults: 2 },
    holds: (analysis) => ready(analysis) && analysis.recommendations.length === 2,
  },
  {
    name: 'complete-draft',
    board: drafted(standard, 8),
    options: { rollouts: 3 },
    holds: (analysis) => analysis.status === 'complete' && analysis.draft.turnIndex === null,
  },
  {
    name: 'city-on-board',
    board: (() => {
      const board = drafted(standard, 3)
      const { vertexId, playerId } = board.buildings[0]
      return placeBuilding(board, vertexId, playerId, 'city')
    })(),
    options: { rollouts: 3 },
    holds: (analysis) => analysis.status === 'complete' && analysis.draft.turnIndex !== null &&
      analysis.warnings.includes('non-settlement-buildings'),
  },
  {
    name: 'me-null',
    board: setMe(drafted(standard, 2), null),
    options: { rollouts: 3 },
    holds: (analysis, board) => board.mePlayerId === null && analysis.status === 'no-me',
  },
  {
    name: 'me-done',
    board: setMe(drafted(standard, 5), 'p4'),
    options: { rollouts: 3 },
    holds: (analysis) => analysis.status === 'me-done' && analysis.draft.turnIndex === 5,
  },
  {
    // My own first pick joins the pre-window beside p4's two.
    name: 'target-later-pick',
    board: midFirstRound,
    targetPick: 5,
    options: { rollouts: 2 },
    holds: readyBehind('p3', 'p4', 'p4'),
  },
  {
    name: 'target-invalid-pick',
    board: midFirstRound,
    targetPick: 3,
    options: { rollouts: 2 },
    holds: (analysis, board) => !analysis.draft.myRemainingPickIndices.includes(3) &&
      text(analysis) === text(analyze(board, undefined, { rollouts: 2 })),
  },
  {
    name: 'target-next-pick',
    board: midFirstRound,
    targetPick: 2,
    options: { rollouts: 2 },
    holds: (analysis, board) => analysis.draft.myRemainingPickIndices[0] === 2 &&
      text(analysis) === text(analyze(board, undefined, { rollouts: 2 })),
  },
  {
    name: 'one-pick-ahead',
    board: behindOne,
    options: { rollouts: 3 },
    holds: readyBehind('aki'),
  },
  {
    name: 'two-picks-ahead',
    board: setMe(standard, 'p3'),
    options: { rollouts: 2 },
    holds: readyBehind('aki', 'p2'),
  },
  {
    name: 'three-picks-ahead',
    board: setMe(worstCase, 'p4'),
    options: { rollouts: 2 },
    holds: readyBehind('aki', 'p2', 'p3'),
  },
  {
    name: 'opponent-top-k-1',
    board: behindOne,
    options: { rollouts: 3, weights: { ...seatWeights, opponentTopK: 1 } },
    holds: readyBehind('aki'),
  },
  {
    name: 'softmax-temperature-0',
    board: behindOne,
    options: { rollouts: 3, weights: { ...seatWeights, softmaxTemperature: 0 } },
    holds: readyBehind('aki'),
  },
  {
    name: 'expansion-weight-0',
    board: behindOne,
    options: { rollouts: 3, weights: { ...seatWeights, expansionWeight: 0 } },
    holds: (analysis) => readyBehind('aki')(analysis) &&
      analysis.recommendations.every(({ breakdown }) => breakdown.expansion === 0),
  },
  {
    // The same request as `one-pick-ahead` but for the seed, which has to move the answer.
    name: 'seed-12345',
    board: behindOne,
    options: { rollouts: 3, seed: 12345 },
    holds: (analysis, board) => readyBehind('aki')(analysis) &&
      text(analysis) !== text(analyze(board, undefined, { rollouts: 3 })),
  },
  {
    name: 'worst-case-default-rollouts',
    board: worstCase,
    holds: (analysis, board) => readyBehind()(analysis) && board.hexes.every((hex) =>
      hex.tile !== 'desert' && pips(hex.numberToken) > 0),
  },
  {
    // p3 placed before its turn, so the snake skips its first slot and p2 alone picks ahead of p4.
    name: 'snake-inconsistent',
    board: setMe(
      placeBuilding(standard, drafted(standard, 1).buildings[0].vertexId, 'p3', 'settlement'),
      'p4',
    ),
    options: { rollouts: 3 },
    holds: (analysis) => analysis.warnings.includes('snake-inconsistent') &&
      !analysis.draft.remainingPickIndices.includes(2) && readyBehind('p2')(analysis),
  },
  {
    // The editor keeps a hex's number when its tile is cleared, so one blank keeps it and one not.
    name: 'blank-tile',
    board: setNumberToken(
      setHexTile(setHexTile(midFirstRound, producing[0].coord, null), producing[1].coord, null),
      producing[1].coord,
      null,
    ),
    options: { rollouts: 3 },
    holds: (analysis, board) => ready(analysis) &&
      board.hexes.some((hex) => hex.tile === null && hex.numberToken !== null) &&
      board.hexes.some((hex) => hex.tile === null && hex.numberToken === null),
  },
  {
    name: 'resource-without-number',
    board: setNumberToken(midFirstRound, producing[0].coord, null),
    options: { rollouts: 3 },
    holds: (analysis, board) => ready(analysis) && board.hexes.some((hex) =>
      hex.tile !== null && hex.tile !== 'desert' && hex.numberToken === null),
  },
  {
    name: 'numberless-board',
    board: withoutNumbers(standard),
    options: { rollouts: 3 },
    holds: (analysis, board) => analysis.status === 'no-production' &&
      board.hexes.every((hex) => hex.numberToken === null),
  },
  {
    name: 'no-robber-no-desert',
    board: (() => {
      const [{ coord }] = midFirstRound.hexes.filter((hex) => hex.tile === 'desert')
      return setRobber(setNumberToken(setHexTile(midFirstRound, coord, 'wood'), coord, 5), null)
    })(),
    options: { rollouts: 3 },
    holds: (analysis, board) => ready(analysis) && board.robber === null &&
      board.hexes.every((hex) => hex.tile !== 'desert'),
  },
  {
    name: 'adjacent-buildings',
    board: (() => {
      const board = drafted(standard, 1)
      const [beside] = adjacency.get(board.buildings[0].vertexId) ?? []
      return setMe(placeBuilding(board, beside, 'p2', 'settlement'), 'p3')
    })(),
    options: { rollouts: 3 },
    holds: (analysis, board) => readyWithPicks(2, 5)(analysis) &&
      (adjacency.get(board.buildings[0].vertexId) ?? []).includes(board.buildings[1].vertexId),
  },
  {
    // A board with no legal vertex needs more settlements than the draft has picks: a settlement
    // bars four vertices at most and the draft twelve picks at most, 48 of the smaller grid's 54.
    // So the draft reads as complete, and `no-availability` cannot come out of `analyzeBoard`.
    name: 'no-legal-vertex',
    board: filled(standard),
    options: { rollouts: 3 },
    holds: (analysis, board) => legalSettlementVertices(board).length === 0 &&
      board.buildings.length > analysis.draft.sequence.length && analysis.status === 'complete',
  },
  {
    // p3 picks twice ahead of p2. Its own ranking is `no-production`, so both picks in the modal
    // pre-window fall back to `opponentPick`.
    name: 'nested-not-ready',
    board: setMe(oneHex, 'p2'),
    options: { rollouts: 3 },
    holds: (analysis, board) => readyBehind('p3', 'p3')(analysis) &&
      analyze(setMe(board, 'p3'), undefined, { rollouts: 3 }).status === 'no-production',
  },
  {
    // With the grant priced, the two orders of a pair are worth different amounts, and the
    // mutual-mate rule drops the order worth less.
    name: 'mutual-mate',
    board: behindOne,
    options: { rollouts: 3, weights: { ...seatWeights, handValueWeight: 0.4 } },
    holds: readyBehind('aki'),
    pairGaps: (gaps) => gaps.some((gap) => Math.abs(gap) > PAIR_TIE),
  },
  {
    // Without the grant the two orders differ by float noise or not at all, and the rule falls to
    // the half worth more alone.
    name: 'pair-inside-tie',
    board: setMe(mapWithSeats('standard4', 3, 23), 'p2'),
    options: { rollouts: 3 },
    holds: readyBehind('aki'),
    pairGaps: (gaps) => gaps.some((gap) => gap !== 0 && Math.abs(gap) <= PAIR_TIE) &&
      gaps.every((gap) => Math.abs(gap) <= PAIR_TIE),
  },
  {
    // Every survivor is listed, so the ones aki's modal pick bars but a sampled pick leaves are in.
    name: 'blocked-in-modal-window',
    board: behindOne,
    options: { rollouts: 6, maxResults: boardGrid('standard4').vertexIds.length },
    holds: (analysis, board) => {
      const modal = blockedVertices(board.layout, [
        ...board.buildings.map(({ vertexId }) => vertexId),
        ...analysis.takenBeforeFirstPick.map(({ vertexId }) => vertexId),
      ])
      return readyBehind('aki')(analysis) && analysis.recommendations.some((entry) =>
        modal.has(entry.firstPick) && entry.survival > 0 && entry.survival < 1)
    },
  },
  {
    name: 'planned-second-three',
    board: setMe(drafted(standard, 1), 'p2'),
    options: { rollouts: 4 },
    holds: (analysis) => readyWithPicks(1, 6)(analysis) &&
      analysis.recommendations.some((entry) => entry.plannedSecond.length === 3),
  },
  {
    name: 'first-road-null',
    board: walledIn,
    options: { rollouts: 2 },
    holds: (analysis) => ready(analysis) && seatWeights.expansionWeight > 0 &&
      analysis.recommendations.some((entry) => entry.firstRoad === null) &&
      analysis.recommendations.some((entry) => entry.firstRoad !== null),
  },
]

function runCase({ name, board, targetPick, options, holds, pairGaps }: CaseInput) {
  const gaps: number[] = []
  const analysis = pairGaps
    ? recordingPairGaps(gaps, () => analyze(board, targetPick, options))
    : analyze(board, targetPick, options)
  if (!holds(analysis, board) || pairGaps?.(gaps) === false) {
    throw new Error(`Corpus case ${name} no longer shows its class`)
  }
  return {
    name,
    request: {
      board,
      ...(targetPick === undefined ? {} : { targetPick }),
      ...(options === undefined ? {} : { options }),
    },
    response: analysis,
  }
}

const firstValues = (seed: number): number[] => {
  const random = mulberry32(seed)
  return Array.from({ length: 16 }, random)
}

const pack = {
  mulberry32: Object.fromEntries(MULBERRY_SEEDS.map((seed) => [String(seed), firstValues(seed)])),
  cases: cases.map(runCase),
}

export const analysisFile = {
  path: resolve(here, '..', 'fixtures', 'analysis-parity.json'),
  contents: `${JSON.stringify(pack, encodeNonFinite, 2)}\n`,
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(analysisFile.path, analysisFile.contents)
}
