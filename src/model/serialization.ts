import { createBoard, validateBoard } from './board'
import { isPrint } from './people'
import { parseEdgeId, parseVertexId } from './coords'
import { CORRECTION_FIELDS, DEV_KINDS, isEmptyCorrection, newGame, reconcileStats, validateGameStats, type AwardHolders, type Correction, type DevHand, type DevKind, type Game, type GameHistory, type PlayerStats, type ScreenshotRead, type SpecialBuildLine, type SpecialBuildRule, type TurnState } from './game'
import { RESOURCES, type AxialCoord, type Board, type Building, type Hex, type LayoutId, type Player, type Port, type Road } from './types'

type ParseBoardResult =
  | { ok: true; board: Board }
  | { ok: false; errors: string[] }

export type ParseGameResult =
  | { ok: true; game: Game }
  | { ok: false; errors: string[] }

export const serializeGame = (game: Game): string => JSON.stringify({
  schemaVersion: game.schemaVersion,
  board: game.board,
  stats: game.stats,
  awards: game.awards,
  turn: game.turn,
  devHand: game.devHand,
  avatars: game.avatars,
  history: game.history,
  pendingImport: game.pendingImport,
  specialBuild: game.specialBuild,
}, null, 2)

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const isCoord = (value: unknown): value is AxialCoord =>
  isRecord(value) && exactKeys(value, ['q', 'r']) && Number.isInteger(value.q) && Number.isInteger(value.r)

const isHex = (value: unknown): value is Hex =>
  isRecord(value) && exactKeys(value, ['coord', 'tile', 'numberToken']) && isCoord(value.coord) &&
  (value.tile === null || ['wood', 'sheep', 'wheat', 'brick', 'ore', 'desert'].includes(String(value.tile))) &&
  (value.numberToken === null || Number.isInteger(value.numberToken))

// Piece ids must round-trip through the canonical parsers: this rejects both
// garbage coordinates (which would make downstream geometry helpers throw)
// and non-canonical orderings that would evade validateBoard's duplicate and
// adjacency checks, which compare ids as strings.
const isCanonicalId = (value: unknown, parse: (id: string) => unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parse(value)
    return true
  } catch {
    return false
  }
}

const isPort = (value: unknown): value is Port =>
  isRecord(value) && exactKeys(value, ['edgeId', 'resource', 'rate']) &&
  isCanonicalId(value.edgeId, parseEdgeId) &&
  (value.resource === null || ['wood', 'sheep', 'wheat', 'brick', 'ore'].includes(String(value.resource))) &&
  Number.isInteger(value.rate)

const isRoad = (value: unknown): value is Road =>
  isRecord(value) && exactKeys(value, ['edgeId', 'playerId']) &&
  isCanonicalId(value.edgeId, parseEdgeId) && typeof value.playerId === 'string'

const isBuilding = (value: unknown): value is Building =>
  isRecord(value) && exactKeys(value, ['vertexId', 'playerId', 'tier']) &&
  isCanonicalId(value.vertexId, parseVertexId) &&
  typeof value.playerId === 'string' && ['settlement', 'city', 'superCity'].includes(String(value.tier))

const isPlayer = (value: unknown): value is Player =>
  isRecord(value) && exactKeys(value, ['id', 'name', 'color']) &&
  typeof value.id === 'string' && typeof value.name === 'string' && typeof value.color === 'string'

function structuralErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['Board must be an object']
  if (value.schemaVersion !== 1) return ['Unsupported schemaVersion, expected 1']
  if (!exactKeys(value, ['schemaVersion', 'layout', 'hexes', 'ports', 'robber', 'roads', 'buildings', 'players', 'mePlayerId'])) {
    return ['Board contains missing or unknown top-level fields']
  }
  const errors: string[] = []
  if (value.layout !== 'standard4' && value.layout !== 'extension6') errors.push('Invalid layout')
  if (!Array.isArray(value.hexes) || !value.hexes.every(isHex)) errors.push('Invalid hexes')
  if (!Array.isArray(value.ports) || !value.ports.every(isPort)) errors.push('Invalid ports')
  if (value.robber !== null && !isCoord(value.robber)) errors.push('Invalid robber')
  if (!Array.isArray(value.roads) || !value.roads.every(isRoad)) errors.push('Invalid roads')
  if (!Array.isArray(value.buildings) || !value.buildings.every(isBuilding)) errors.push('Invalid buildings')
  if (!Array.isArray(value.players) || !value.players.every(isPlayer)) errors.push('Invalid players')
  if (value.mePlayerId !== null && typeof value.mePlayerId !== 'string') errors.push('Invalid mePlayerId')
  return errors
}

export function parseBoard(data: unknown): ParseBoardResult {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return { ok: false, errors: ['Invalid JSON'] }
    }
  } else {
    // Own the result outright. A caller that keeps a handle on the object it
    // passed in must not be able to mutate a live Board afterwards: the analysis
    // and standings caches both key on board/game identity.
    value = structuredClone(data)
  }
  const errors = structuralErrors(value)
  if (errors.length > 0) return { ok: false, errors }
  const board = value as Board
  const issues = validateBoard(board)
  const invariantErrors = issues.filter((issue) => issue.severity === 'error')
  if (invariantErrors.length > 0) return { ok: false, errors: invariantErrors.map((issue) => issue.message) }
  return { ok: true, board }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

function isScreenshotRead(value: unknown, board: Board): value is ScreenshotRead {
  const inRoster = (id: unknown) => typeof id === 'string' && board.players.some((player) => player.id === id)
  return isRecord(value) && exactKeys(value, ['roster', 'order', 'picks', 'hands', 'unorderedPicks', 'points', 'knights']) &&
    typeof value.roster === 'boolean' && typeof value.order === 'boolean' && typeof value.picks === 'boolean' &&
    ['hands', 'unorderedPicks', 'knights'].every((key) => Array.isArray(value[key]) && value[key].every(inRoster)) &&
    isRecord(value.points) && Object.entries(value.points).every(([id, points]) => inRoster(id) && isCount(points))
}

function normalizeDevCounts(value: unknown): Record<DevKind, number> | null {
  if (!isRecord(value) || !exactKeys(value, DEV_KINDS) ||
    !isCount(value.knight) || !isCount(value.roadBuilding) ||
    !isCount(value.yearOfPlenty) || !isCount(value.monopoly)) return null
  return { knight: value.knight, roadBuilding: value.roadBuilding, yearOfPlenty: value.yearOfPlenty, monopoly: value.monopoly }
}

function normalizePlayerStats(value: unknown): PlayerStats | null {
  if (!isRecord(value)) return null
  if (!exactKeys(value, ['hand', 'devCards', 'knights', 'vpCards', 'handUnknown'])) return null
  const hand = value.hand
  if (!isRecord(hand) || !exactKeys(hand, RESOURCES) ||
    !isCount(hand.wood) || !isCount(hand.sheep) || !isCount(hand.wheat) ||
    !isCount(hand.brick) || !isCount(hand.ore) ||
    !isCount(value.devCards) || !isCount(value.knights) || !isCount(value.vpCards) ||
    !isCount(value.handUnknown)) {
    return null
  }
  return {
    hand: { wood: hand.wood, sheep: hand.sheep, wheat: hand.wheat, brick: hand.brick, ore: hand.ore },
    handUnknown: value.handUnknown,
    devCards: value.devCards,
    knights: value.knights,
    vpCards: value.vpCards,
  }
}

const isLog = (value: unknown): value is string[] => Array.isArray(value) && value.every((line) => typeof line === 'string')
const isSpecialBuilds = (value: unknown): value is SpecialBuildLine[] => Array.isArray(value) && value.length > 0 &&
  value.every((line) => isRecord(line) && exactKeys(line, ['playerId', 'text']) && typeof line.playerId === 'string' && typeof line.text === 'string')
const isSpecialBuildRule = (value: unknown): value is SpecialBuildRule => isRecord(value) && exactKeys(value, ['timing', 'who']) &&
  ['everyTurn', 'across'].includes(String(value.timing)) && ['overSeven', 'always'].includes(String(value.who))
const isRoll = (value: unknown): value is number | null => value === null || isCount(value) && value >= 2 && value <= 12
const isGains = (value: unknown): value is NonNullable<TurnState['gains']> =>
  isRecord(value) && Object.values(value).every((cards) => isRecord(cards) &&
    Object.entries(cards).every(([resource, count]) => (RESOURCES as readonly string[]).includes(resource) && isCount(count) && count > 0))

const isCorrection = (value: unknown): value is Correction =>
  isRecord(value) && exactKeys(value, ['changes', ...Object.hasOwn(value, 'awards') ? ['awards'] : []]) &&
  isRecord(value.changes) && Object.values(value.changes).every((fields) => isRecord(fields) && Object.keys(fields).length > 0 &&
    Object.entries(fields).every(([field, delta]) => (CORRECTION_FIELDS as readonly string[]).includes(field) && Number.isInteger(delta) && delta !== 0)) &&
  (!Object.hasOwn(value, 'awards') || isRecord(value.awards) && Object.keys(value.awards).length > 0 &&
    Object.entries(value.awards).every(([kind, holder]) => ['longestRoad', 'largestArmy'].includes(kind) && typeof holder === 'string'))

function isHistoryPosition(value: Record<string, unknown>, record = false): boolean {
  if (value.robber !== null && !isCoord(value.robber)) return false
  if ((!record || Object.hasOwn(value, 'stats')) && (!isRecord(value.stats) ||
    !Object.values(value.stats).every((stats) => record && stats === null || normalizePlayerStats(stats) !== null))) return false
  if (Object.hasOwn(value, 'awards')) {
    const awards = value.awards
    if (!isRecord(awards) || !exactKeys(awards, ['longestRoad', 'largestArmy']) ||
      !Object.values(awards).every((id) => id === null || typeof id === 'string')) return false
  }
  if (Object.hasOwn(value, 'devHand')) {
    const hand = value.devHand
    if (!isRecord(hand) || !exactKeys(hand, ['playerId', 'playable', 'bought']) || typeof hand.playerId !== 'string' ||
      !normalizeDevCounts(hand.playable) || !normalizeDevCounts(hand.bought)) return false
  }
  return true
}

function isHistory(value: unknown): value is GameHistory {
  if (!isRecord(value) || !exactKeys(value, ['start', 'turns'])) return false
  const start = value.start
  if (!isRecord(start) || !exactKeys(start, ['buildings', 'roads', 'robber', 'stats',
    ...['awards', 'devHand'].filter((key) => Object.hasOwn(start, key))]) || !isHistoryPosition(start) ||
    !Array.isArray(start.buildings) || !start.buildings.every(isBuilding) ||
    !Array.isArray(start.roads) || !start.roads.every(isRoad)) return false
  return Array.isArray(value.turns) && value.turns.every((record: unknown) => {
    if (!isRecord(record) || !exactKeys(record, ['playerId', 'rolled', 'log', 'robber',
      ...['gains', 'specialBuilds', 'buildings', 'roads', 'stats', 'awards', 'devHand'].filter((key) => Object.hasOwn(record, key))]) ||
      typeof record.playerId !== 'string' || !isRoll(record.rolled) || !isLog(record.log) || !isHistoryPosition(record, true)) return false
    if (Object.hasOwn(record, 'gains') && !isGains(record.gains)) return false
    if (Object.hasOwn(record, 'specialBuilds') && !isSpecialBuilds(record.specialBuilds)) return false
    if (Object.hasOwn(record, 'buildings') && (!isRecord(record.buildings) ||
      !Object.entries(record.buildings).every(([id, piece]) => isCanonicalId(id, parseVertexId) &&
        (piece === null || isBuilding(piece) && piece.vertexId === id)))) return false
    if (Object.hasOwn(record, 'roads') && (!isRecord(record.roads) ||
      !Object.entries(record.roads).every(([id, owner]) => isCanonicalId(id, parseEdgeId) &&
        (owner === null || typeof owner === 'string')))) return false
    return true
  })
}

/** Parse a game, zero-filling missing roster stats while rejecting malformed data. */
export function parseGame(data: unknown): ParseGameResult {
  let value = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return { ok: false, errors: ['Invalid JSON'] }
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ['Game must be an object'] }
  if (value.schemaVersion !== 1) return { ok: false, errors: ['Unsupported game schemaVersion, expected 1'] }
  if (!['schemaVersion', 'board', 'stats'].every((key) => Object.hasOwn(value, key)) ||
    !Object.keys(value).every((key) => ['schemaVersion', 'board', 'stats', 'awards', 'turn', 'devHand', 'history', 'pendingImport', 'avatars', 'specialBuild'].includes(key))) {
    return { ok: false, errors: ['Game contains missing or unknown top-level fields'] }
  }
  const parsedBoard = parseBoard(value.board)
  if (!parsedBoard.ok) return parsedBoard
  const inRoster = (id: unknown): id is string =>
    typeof id === 'string' && parsedBoard.board.players.some((player) => player.id === id)
  let pendingImport: ScreenshotRead | undefined
  if (Object.hasOwn(value, 'pendingImport')) {
    if (!isScreenshotRead(value.pendingImport, parsedBoard.board)) return { ok: false, errors: ['Invalid pending import'] }
    pendingImport = structuredClone(value.pendingImport)
  }
  let avatars: Record<string, string> | undefined
  if (Object.hasOwn(value, 'avatars')) {
    if (!isRecord(value.avatars) || !Object.entries(value.avatars).every(([id, print]) => inRoster(id) && isPrint(print))) {
      return { ok: false, errors: ['Invalid avatars'] }
    }
    avatars = { ...value.avatars } as Record<string, string>
  }
  if (Object.hasOwn(value, 'specialBuild') && !isSpecialBuildRule(value.specialBuild)) return { ok: false, errors: ['Invalid special build rule'] }
  let awards: AwardHolders | undefined
  if (Object.hasOwn(value, 'awards')) {
    if (!isRecord(value.awards) || !exactKeys(value.awards, ['longestRoad', 'largestArmy'])) {
      return { ok: false, errors: ['Invalid award holders'] }
    }
    const { longestRoad, largestArmy } = value.awards
    const validHolder = (id: unknown): id is string | null => id === null || inRoster(id)
    if (!validHolder(longestRoad) || !validHolder(largestArmy)) return { ok: false, errors: ['Award holder is not in the roster'] }
    awards = { longestRoad, largestArmy }
  }
  let turn: TurnState | undefined
  if (Object.hasOwn(value, 'turn')) {
    const savedTurn = value.turn
    if (!isRecord(savedTurn) || !exactKeys(savedTurn, ['playerId', 'rolled', 'devPlayed', 'progressPlayed',
      ...['robberMoved', 'devBought', 'log', 'gains', 'correction', 'specialBuilds'].filter((key) => Object.hasOwn(savedTurn, key))])) {
      return { ok: false, errors: ['Invalid turn state'] }
    }
    const { playerId, rolled, devPlayed, progressPlayed } = savedTurn
    if (!inRoster(playerId) ||
      !isRoll(rolled) ||
      typeof devPlayed !== 'boolean' || !isRecord(progressPlayed) ||
      !exactKeys(progressPlayed, ['roadBuilding', 'yearOfPlenty', 'monopoly']) ||
      !isCount(progressPlayed.roadBuilding) || !isCount(progressPlayed.yearOfPlenty) || !isCount(progressPlayed.monopoly)) {
      return { ok: false, errors: ['Invalid turn state'] }
    }
    turn = { playerId, rolled, devPlayed, progressPlayed: {
      roadBuilding: progressPlayed.roadBuilding, yearOfPlenty: progressPlayed.yearOfPlenty, monopoly: progressPlayed.monopoly,
    } }
    if (Object.hasOwn(savedTurn, 'robberMoved')) {
      if (typeof savedTurn.robberMoved !== 'boolean') return { ok: false, errors: ['Invalid turn state'] }
      turn.robberMoved = savedTurn.robberMoved
    }
    if (Object.hasOwn(savedTurn, 'devBought')) {
      if (!isCount(savedTurn.devBought)) return { ok: false, errors: ['Invalid turn state'] }
      turn.devBought = savedTurn.devBought
    }
    if (Object.hasOwn(savedTurn, 'log')) {
      if (!isLog(savedTurn.log)) return { ok: false, errors: ['Invalid turn log'] }
      turn.log = [...savedTurn.log]
    }
    if (Object.hasOwn(savedTurn, 'specialBuilds')) {
      // A builder removed from the roster mid-turn keeps their line, as history keeps removed players.
      if (!isSpecialBuilds(savedTurn.specialBuilds)) return { ok: false, errors: ['Invalid special builds'] }
      turn.specialBuilds = structuredClone(savedTurn.specialBuilds)
    }
    if (Object.hasOwn(savedTurn, 'gains')) {
      if (!isGains(savedTurn.gains)) return { ok: false, errors: ['Invalid turn gains'] }
      turn.gains = structuredClone(savedTurn.gains)
    }
    if (Object.hasOwn(savedTurn, 'correction')) {
      if (!isCorrection(savedTurn.correction)) return { ok: false, errors: ['Invalid turn correction'] }
      turn.correction = structuredClone(savedTurn.correction)
      // The next correction rewrites the log's last line, so an open run must own it.
      if (!isEmptyCorrection(turn.correction) && !turn.log?.at(-1)?.startsWith('Corrected ')) return { ok: false, errors: ['Invalid turn correction'] }
    }
  }
  let devHand: DevHand | undefined
  if (Object.hasOwn(value, 'devHand')) {
    if (!isRecord(value.devHand) || !exactKeys(value.devHand, ['playerId', 'playable', 'bought']) ||
      !inRoster(value.devHand.playerId)) {
      return { ok: false, errors: ['Invalid dev hand'] }
    }
    const playable = normalizeDevCounts(value.devHand.playable)
    const bought = normalizeDevCounts(value.devHand.bought)
    if (!playable || !bought) return { ok: false, errors: ['Invalid dev hand'] }
    devHand = { playerId: value.devHand.playerId, playable, bought }
  }
  if (!isRecord(value.stats)) {
    return { ok: false, errors: ['Invalid player stats'] }
  }

  // Normalization rebuilds the stats graph so parsed games never alias input.
  const normalizedEntries = Object.entries(value.stats).map(([id, stats]) => {
    const normalized = normalizePlayerStats(stats)
    return normalized ? [id, normalized] as const : null
  })
  if (normalizedEntries.some((entry) => entry === null)) {
    return { ok: false, errors: ['Invalid player stats'] }
  }
  const stats = Object.fromEntries(normalizedEntries as [string, PlayerStats][])
  const game: Game = {
    schemaVersion: 1,
    board: parsedBoard.board,
    stats: reconcileStats(stats, parsedBoard.board.players),
    ...(awards === undefined ? {} : { awards }),
    ...(turn === undefined ? {} : { turn }),
    ...(devHand === undefined ? {} : { devHand }),
    ...(avatars === undefined ? {} : { avatars }),
    ...(isHistory(value.history) ? { history: structuredClone(value.history) } : {}),
    ...(pendingImport === undefined ? {} : { pendingImport }),
    ...(isSpecialBuildRule(value.specialBuild) ? { specialBuild: { timing: value.specialBuild.timing, who: value.specialBuild.who } } : {}),
  }
  // reconcileStats zero-fills missing entries, so any surviving issue is a
  // stats key pointing at a player outside the roster.
  const statErrors = validateGameStats({ ...game, stats })
    .filter((issue) => issue.code === 'stats-unknown-player')
  if (statErrors.length > 0) return { ok: false, errors: statErrors.map((issue) => issue.message) }
  return { ok: true, game }
}

// Memoized on game identity: games are immutable, and the UI compares
// signatures on every render and autosave.
const signatures = new WeakMap<Game, string>()

export function gameSignature(game: Game): string {
  const cached = signatures.get(game)
  if (cached !== undefined) return cached
  const value = serializeGame(game)
  signatures.set(game, value)
  return value
}

// One fresh game per layout, rather than building and serializing a
// throwaway baseline for every unlinked tab on every render.
const fresh = new Map<LayoutId, string>()

/** Nothing beyond a fresh board of its layout: the autosave and a backup both leave such a tab out. */
export function isFreshGame(game: Game): boolean {
  const { layout } = game.board
  let baseline = fresh.get(layout)
  if (baseline === undefined) {
    baseline = serializeGame(newGame(createBoard(layout)))
    fresh.set(layout, baseline)
  }
  return gameSignature(game) === baseline
}
