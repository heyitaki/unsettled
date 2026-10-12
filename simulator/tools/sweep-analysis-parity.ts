import { createEngine, reviveNonFinite } from '../../src/engine/advice/wasm.ts'
import { analyzeBoard } from '../../src/engine/analyze.ts'
import { inferDraftState } from '../../src/engine/draft.ts'
import { legalSettlementVertices } from '../../src/engine/legality.ts'
import { mulberry32 } from '../../src/engine/random.ts'
import {
  addPlayer,
  createBoard,
  draftOrder,
  placeBuilding,
  placeRoad,
  randomizeBoard,
  setHexTile,
  setMe,
  setNumberToken,
} from '../../src/model/board.ts'
import { vertexIncidentEdgeIds } from '../../src/model/coords.ts'
import { boardGrid } from '../../src/model/layouts.ts'
import { PLAYER_PALETTE, type Board, type LayoutId } from '../../src/model/types.ts'
import { readFileSync } from 'node:fs'

// One-off check that the built wasm analysis returns what the TypeScript analysis returns on draft
// states the corpus does not hold. Run from `simulator/`: `npx tsx tools/sweep-analysis-parity.ts
// [seed]`. It exits non-zero listing every state the two disagree on.

const SEED = Number(process.argv[2] ?? 20261012)
/** States per layout, roster size and count of placed settlements: 96 of those, so 384 states. */
const REPLICAS = 4
const ROLLOUTS = 3
const TOLERANCE = 1e-9

const random = mulberry32(SEED)
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]

interface State {
  name: string
  request: { board: Board; targetPick?: number; options: { rollouts: number } }
}

/** A random map of the layout with `seats` players, `randomizeBoard` drawing from the sweep's generator. */
function mapWithSeats(layout: LayoutId, seats: number): Board {
  const colors = Object.values(PLAYER_PALETTE)
  let board = createBoard(layout)
  for (let index = 1; index < seats; index += 1) {
    board = addPlayer(board, { id: `p${index + 1}`, name: `P${index + 1}`, color: colors[index] })
  }
  const original = Math.random
  Math.random = random
  try {
    return randomizeBoard(board)
  } finally {
    Math.random = original
  }
}

/** The first `placed` picks of the snake on any legal vertex, half of them with a road. */
function drafted(board: Board, placed: number): Board {
  const gridEdges = new Set(boardGrid(board.layout).edgeIds)
  const order = draftOrder(board)
  let next = board
  for (let turn = 0; turn < placed; turn += 1) {
    const vertexId = pick(legalSettlementVertices(next))
    next = placeBuilding(next, vertexId, order[turn], 'settlement')
    if (random() < 0.5) {
      // A coastal vertex has edges running out to sea.
      const edges = vertexIncidentEdgeIds(vertexId).filter((edgeId) => gridEdges.has(edgeId))
      next = placeRoad(next, pick(edges), order[turn])
    }
  }
  return next
}

function buildState(layout: LayoutId, seats: number, placed: number, index: number): State {
  let board = drafted(mapWithSeats(layout, seats), placed)
  const me = random() < 0.05 ? null : pick(board.players).id
  board = setMe(board, me)

  let edit = 'none'
  if (index % 10 === 0) {
    // The editor keeps a hex's number when its tile is cleared.
    const { coord } = pick(board.hexes.filter((hex) => hex.numberToken !== null))
    edit = random() < 0.5 ? 'blank-tile' : 'no-number'
    board = edit === 'blank-tile' ? setHexTile(board, coord, null) : setNumberToken(board, coord, null)
  }

  let targetPick: number | undefined
  if (index % 3 === 0) {
    // Mostly a later pick of the claimed player, else any index: their next pick, a rival's, one past the end.
    const { myRemainingPickIndices: mine, sequence } = inferDraftState(board)
    targetPick = mine.length > 1 && random() < 0.75
      ? mine[mine.length - 1]
      : Math.floor(random() * (sequence.length + 1))
  }

  return {
    name: `#${index} ${layout} seats=${seats} placed=${placed} me=${me} target=${targetPick} edit=${edit}`,
    request: { board, ...(targetPick === undefined ? {} : { targetPick }), options: { rollouts: ROLLOUTS } },
  }
}

const encodeNonFinite = (_key: string, value: unknown): unknown => {
  if (typeof value !== 'number' || Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

/** Paths where the two differ: order, names, strings and nulls exactly, finite numbers within the tolerance. */
function differences(actual: unknown, expected: unknown, path: string, out: string[]): void {
  if (typeof actual === 'number' && typeof expected === 'number' && Number.isFinite(expected)) {
    if (!(Math.abs(actual - expected) <= TOLERANCE)) out.push(`${path}: ${actual} against ${expected}`)
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) out.push(`${path}: length ${actual.length} against ${expected.length}`)
    else expected.forEach((value, index) => differences(actual[index], value, `${path}[${index}]`, out))
  } else if (actual !== null && expected !== null && typeof actual === 'object' && typeof expected === 'object' &&
    !Array.isArray(actual) && !Array.isArray(expected)) {
    // Key order is the writer's own and is not part of the response.
    const keys = Object.keys(expected).sort()
    if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(keys)) {
      out.push(`${path}: keys ${Object.keys(actual).sort()} against ${keys}`)
    } else {
      for (const key of keys) {
        differences((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`, out)
      }
    }
  } else if (!Object.is(actual, expected)) {
    out.push(`${path}: ${JSON.stringify(actual)} against ${JSON.stringify(expected)}`)
  }
}

// One instance for the whole sweep, as one worker serves the app, so its nested-ranking cache is in play.
const engine = await createEngine(
  readFileSync(new URL('../../src/engine/advice/engine.wasm', import.meta.url)),
  () => {},
)

const mismatches: string[] = []
const statuses = new Map<string, number>()
let states = 0
for (const layout of ['standard4', 'extension6'] as const) {
  for (let seats = 1; seats <= 6; seats += 1) {
    for (let placed = 0; placed <= 2 * seats; placed += 1) {
      for (let replica = 0; replica < REPLICAS; replica += 1) {
        const { name, request } = buildState(layout, seats, placed, states)
        states += 1
        const { board, targetPick, options } = request
        const analysis = analyzeBoard(board, { targetPick, ...options })
        const expected: unknown = JSON.parse(JSON.stringify(analysis, encodeNonFinite), reviveNonFinite)
        const found: string[] = []
        differences(engine.analyze(JSON.stringify(request)), expected, 'response', found)
        if (found.length > 0) mismatches.push(`${name}\n  ${found.slice(0, 8).join('\n  ')}`)
        statuses.set(analysis.status, (statuses.get(analysis.status) ?? 0) + 1)
      }
    }
    console.log(`${layout} seats=${seats}: ${states} states, ${mismatches.length} mismatches so far`)
  }
}

const counts = [...statuses].sort().map(([status, count]) => `${status} ${count}`).join(', ')
console.log(`seed ${SEED}: ${states} states (${counts}), ${mismatches.length} mismatches`)
if (mismatches.length > 0) {
  console.error(mismatches.join('\n'))
  process.exit(1)
}
