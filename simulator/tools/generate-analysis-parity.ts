import { analyzeBoard, type DraftAnalysis } from '../../src/engine/analyze.ts'
import { legalSettlementVertices } from '../../src/engine/legality.ts'
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
  vertexProduction,
} from '../../src/model/board.ts'
import { vertexIncidentEdgeIds } from '../../src/model/coords.ts'
import { boardGrid } from '../../src/model/layouts.ts'
import { PLAYER_PALETTE, type Board, type LayoutId, type VertexId } from '../../src/model/types.ts'
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

const pipTotal = (board: Board, vertexId: VertexId): number =>
  Object.values(vertexProduction(board, vertexId)).reduce((sum, amount) => sum + amount, 0)

/**
 * The first `count` picks of the snake, placed as a table would: each on one of the six legal
 * vertices with the most pips, chosen by a seeded generator, with a road on one of its edges.
 */
function drafted(board: Board, count: number, seed = 1): Board {
  const random = mulberry32(seed)
  const grid = boardGrid(board.layout)
  const gridEdges = new Set(grid.edgeIds)
  const order = draftOrder(board)
  let next = board
  for (let turn = 0; turn < count; turn += 1) {
    const playerId = order[turn]
    const best = legalSettlementVertices(next)
      .map((vertexId) => ({ vertexId, pips: pipTotal(next, vertexId) }))
      .sort((a, b) => b.pips - a.pips)
      .slice(0, 6)
    const { vertexId } = best[Math.floor(random() * best.length)]
    const edges = vertexIncidentEdgeIds(vertexId).filter((edgeId) => gridEdges.has(edgeId))
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
]

function runCase({ name, board, targetPick, options, holds }: CaseInput) {
  const analysis = analyze(board, targetPick, options)
  if (!holds(analysis, board)) throw new Error(`Corpus case ${name} no longer shows its class`)
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
