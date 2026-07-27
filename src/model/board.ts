import { axialKey, neighbor, parseAxialKey, vertexAdjacentVertexIds, vertexTouchingHexes } from './coords'
import { newId } from './ids'
import { boardGrid, defaultPortEdges, NUMBER_TOKEN_COUNTS } from './layouts'
import {
  PLAYER_PALETTE,
  RESOURCES,
  type AxialCoord,
  type Board,
  type BuildingTier,
  type EdgeId,
  type Issue,
  type LayoutId,
  type Player,
  type Resource,
  type TileKind,
  type VertexId,
} from './types'

// Every mutator below returns the board it was given when the edit would change
// nothing, and composes: an edit built from several of them (erase hits a road
// and a port) hands back the original reference when none of them bit. The
// store keys its undo stack on board identity, so this is what keeps a stray
// click — repainting a wheat hex wheat, erasing empty water — from becoming an
// undo step that visibly does nothing.
const sameCoord = (a: AxialCoord | null, b: AxialCoord | null): boolean =>
  a === b || (a !== null && b !== null && a.q === b.q && a.r === b.r)

const replaceHex = (
  board: Board,
  coord: AxialCoord,
  update: (hex: Board['hexes'][number]) => Board['hexes'][number],
): Board => {
  const key = axialKey(coord)
  if (!boardGrid(board.layout).landKeys.has(key)) throw new RangeError(`Unknown hex ${key}`)
  const index = board.hexes.findIndex((hex) => sameCoord(hex.coord, coord))
  if (index < 0) return board
  const hex = board.hexes[index]
  // update() runs first either way: it is also where the desert/token conflict
  // throws, and that rejection must not depend on the outcome being a change.
  const next = update(hex)
  // Every field of Hex, coord included: a partial comparison would silently
  // drop an edit that only touched what it left out.
  if (next.tile === hex.tile && next.numberToken === hex.numberToken && sameCoord(next.coord, hex.coord)) return board
  const hexes = [...board.hexes]
  hexes[index] = next
  return { ...board, hexes }
}

const defaultPorts = (layout: LayoutId): Board['ports'] =>
  defaultPortEdges(layout).map((edgeId) => ({ edgeId, resource: null, rate: 3 }))

export function createBoard(layout: LayoutId): Board {
  return {
    schemaVersion: 1,
    layout,
    hexes: boardGrid(layout).landCoords.map((coord) => ({
      coord: { ...coord },
      tile: null,
      numberToken: null,
    })),
    ports: defaultPorts(layout),
    robber: null,
    roads: [],
    buildings: [],
    players: [{ id: 'aki', name: 'aki', color: PLAYER_PALETTE.red }],
    mePlayerId: 'aki',
  }
}

// The tiles each layout ships with. Counts (and NUMBER_TOKEN_COUNTS) mirror a
// physical Catan box, so a randomized board is a legal starting map.
const RESOURCE_COUNTS: Record<LayoutId, Record<TileKind, number>> = {
  standard4: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
  extension6: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
}

const isRedToken = (token: number): boolean => token === 6 || token === 8

function shuffle<T>(items: readonly T[]): T[] {
  const array = [...items]
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[array[index], array[swap]] = [array[swap], array[index]]
  }
  return array
}

const hexesAdjacent = (a: string, b: string): boolean => {
  const coord = parseAxialKey(a)
  for (let dir = 0; dir < 6; dir += 1) if (axialKey(neighbor(coord, dir)) === b) return true
  return false
}

/**
 * Generate a legal Catan starting map for the board's layout: the correct
 * multiset of resource tiles and number tokens, with the red (6/8) high-odds
 * tokens placed as an independent set so no two ever touch — the one arrangement
 * rule a hand-dealt board always follows. Players, ports, and mePlayerId are
 * kept; roads and buildings are cleared and the robber moves onto a desert.
 */
export function randomizeBoard(board: Board): Board {
  const layout = board.layout
  const coords = boardGrid(layout).landCoords

  // Scatter the tile multiset across every land hex.
  const tilePool = shuffle(
    (Object.entries(RESOURCE_COUNTS[layout]) as [TileKind, number][])
      .flatMap(([tile, count]) => Array.from({ length: count }, () => tile)),
  )
  const tiles = new Map<string, TileKind>()
  coords.forEach((coord, index) => tiles.set(axialKey(coord), tilePool[index]))

  // Every non-desert hex carries a token. Choose the red hexes first as a random
  // independent set (no two adjacent), then fill the rest with the other tokens.
  const resourceKeys = coords.map(axialKey).filter((key) => tiles.get(key) !== 'desert')
  const tokenPool = (Object.entries(NUMBER_TOKEN_COUNTS[layout]) as [string, number][])
    .flatMap(([token, count]) => Array.from({ length: count }, () => Number(token)))
  const redCount = tokenPool.filter(isRedToken).length

  let redKeys: string[] = []
  for (let attempt = 0; attempt < 300 && redKeys.length < redCount; attempt += 1) {
    const picked: string[] = []
    for (const key of shuffle(resourceKeys)) {
      if (picked.length === redCount) break
      if (picked.every((other) => !hexesAdjacent(key, other))) picked.push(key)
    }
    if (picked.length === redCount) redKeys = picked
  }
  // Degenerate fallback (should never trigger on real layouts): place greedily.
  if (redKeys.length < redCount) redKeys = shuffle(resourceKeys).slice(0, redCount)

  const redSet = new Set(redKeys)
  const reds = shuffle(tokenPool.filter(isRedToken))
  const others = shuffle(tokenPool.filter((token) => !isRedToken(token)))
  const tokens = new Map<string, number>()
  redKeys.forEach((key, index) => tokens.set(key, reds[index]))
  for (const key of resourceKeys) if (!redSet.has(key)) tokens.set(key, others.pop() as number)

  const desert = coords.find((coord) => tiles.get(axialKey(coord)) === 'desert')

  return {
    ...board,
    hexes: coords.map((coord) => {
      const tile = tiles.get(axialKey(coord)) as TileKind
      return {
        coord: { ...coord },
        tile,
        numberToken: tile === 'desert' ? null : (tokens.get(axialKey(coord)) as number),
      }
    }),
    robber: desert ? { ...desert } : null,
    roads: [],
    buildings: [],
  }
}

export function setHexTile(board: Board, coord: AxialCoord, tile: TileKind | null): Board {
  return replaceHex(board, coord, (hex) => ({
    ...hex,
    tile,
    numberToken: tile === 'desert' ? null : hex.numberToken,
  }))
}

export function setTile(
  board: Board,
  coord: AxialCoord,
  tile: TileKind | null,
  numberToken: number | null = null,
): Board {
  const withTile = setHexTile(board, coord, tile)
  return setNumberToken(withTile, coord, tile === 'desert' ? null : numberToken)
}

export function setNumberToken(board: Board, coord: AxialCoord, numberToken: number | null): Board {
  if (numberToken !== null && (!Number.isInteger(numberToken) || numberToken < 2 || numberToken > 12 || numberToken === 7)) {
    throw new RangeError('Number tokens must be 2 through 12, excluding 7')
  }
  return replaceHex(board, coord, (hex) => {
    if (hex.tile === 'desert' && numberToken !== null) throw new Error('Deserts cannot have number tokens')
    return { ...hex, numberToken }
  })
}

export function setRobber(board: Board, coord: AxialCoord | null): Board {
  if (coord && !boardGrid(board.layout).landKeys.has(axialKey(coord))) throw new RangeError('Robber is off-board')
  if (sameCoord(board.robber, coord)) return board
  return { ...board, robber: coord ? { ...coord } : null }
}

export function upsertPort(board: Board, edgeId: EdgeId, resource: Resource | null, rate: number): Board {
  if (!Number.isInteger(rate) || rate < 2) throw new RangeError('Port rates must be integers of at least 2')
  if (!boardGrid(board.layout).coastalEdgeIds.includes(edgeId)) throw new RangeError('Ports must be coastal')
  const found = board.ports.find((candidate) => candidate.edgeId === edgeId)
  if (found && found.resource === resource && found.rate === rate) return board
  const port = { edgeId, resource, rate }
  return {
    ...board,
    ports: found ? board.ports.map((candidate) => candidate.edgeId === edgeId ? port : candidate) : [...board.ports, port],
  }
}

export const removePort = (board: Board, edgeId: EdgeId): Board =>
  board.ports.some((port) => port.edgeId === edgeId)
    ? { ...board, ports: board.ports.filter((port) => port.edgeId !== edgeId) }
    : board

function ensurePlayer(board: Board, playerId: string): void {
  if (!board.players.some((player) => player.id === playerId)) throw new RangeError(`Unknown player ${playerId}`)
}

export function placeRoad(board: Board, edgeId: EdgeId, playerId: string): Board {
  ensurePlayer(board, playerId)
  if (!boardGrid(board.layout).edgeIds.includes(edgeId)) throw new RangeError(`Unknown edge ${edgeId}`)
  if (board.roads.some((road) => road.edgeId === edgeId && road.playerId === playerId)) return board
  return {
    ...board,
    roads: [...board.roads.filter((road) => road.edgeId !== edgeId), { edgeId, playerId }],
  }
}

export const removeRoad = (board: Board, edgeId: EdgeId): Board =>
  board.roads.some((road) => road.edgeId === edgeId)
    ? { ...board, roads: board.roads.filter((road) => road.edgeId !== edgeId) }
    : board

export function placeBuilding(
  board: Board,
  vertexId: VertexId,
  playerId: string,
  tier: BuildingTier,
): Board {
  ensurePlayer(board, playerId)
  if (!boardGrid(board.layout).vertexIds.includes(vertexId)) throw new RangeError(`Unknown vertex ${vertexId}`)
  const next = { vertexId, playerId, tier }
  const occupied = board.buildings.findIndex((building) => building.vertexId === vertexId)
  // Upgrading your own building keeps its index, because the draft strip maps a
  // player's k-th building to their k-th pick. Taking over another player's
  // vertex is a first placement for the new owner, so it appends instead.
  if (occupied !== -1 && board.buildings[occupied].playerId === playerId) {
    if (board.buildings[occupied].tier === tier) return board
    const buildings = [...board.buildings]
    buildings[occupied] = next
    return { ...board, buildings }
  }
  return {
    ...board,
    buildings: [...board.buildings.filter((building) => building.vertexId !== vertexId), next],
  }
}

export const removeBuilding = (board: Board, vertexId: VertexId): Board =>
  board.buildings.some((building) => building.vertexId === vertexId)
    ? { ...board, buildings: board.buildings.filter((building) => building.vertexId !== vertexId) }
    : board

export function addPlayer(board: Board, input: Omit<Player, 'id'> & { id?: string }): Board {
  if (board.players.length >= 6) return board
  const id = input.id ?? newId()
  if (board.players.some((player) => player.id === id)) throw new Error(`Duplicate player ID ${id}`)
  return { ...board, players: [...board.players, { id, name: input.name, color: input.color }] }
}

export const renamePlayer = (board: Board, playerId: string, name: string): Board =>
  board.players.some((player) => player.id === playerId && player.name !== name)
    ? { ...board, players: board.players.map((player) => player.id === playerId ? { ...player, name } : player) }
    : board

export function movePlayer(board: Board, playerId: string, index: number): Board {
  const current = board.players.findIndex((player) => player.id === playerId)
  if (current < 0) return board
  // Clamped against the roster with the dragged player lifted out, so a drop
  // past either end lands back on the slot they already hold.
  const target = Math.max(0, Math.min(index, board.players.length - 1))
  if (target === current) return board
  const players = [...board.players]
  const [player] = players.splice(current, 1)
  players.splice(target, 0, player)
  return { ...board, players }
}

export function removePlayer(board: Board, playerId: string): Board {
  if (board.players.length <= 1) return board
  return {
    ...board,
    players: board.players.filter((player) => player.id !== playerId),
    roads: board.roads.filter((road) => road.playerId !== playerId),
    buildings: board.buildings.filter((building) => building.playerId !== playerId),
    mePlayerId: board.mePlayerId === playerId ? null : board.mePlayerId,
  }
}

export function setMe(board: Board, playerId: string | null): Board {
  if (playerId !== null) ensurePlayer(board, playerId)
  if (board.mePlayerId === playerId) return board
  return { ...board, mePlayerId: playerId }
}

export function setLayout(board: Board, layout: LayoutId): Board {
  const fresh = createBoard(layout)
  return { ...fresh, players: board.players.map((player) => ({ ...player })), mePlayerId: board.mePlayerId }
}

// Nothing on the board but its layout and roster. Ports outlive a clear, so
// blank means the ports are still the layout's defaults — in any order, since
// deleting one and drawing it back leaves the same set rearranged.
export const isBlank = (board: Board): boolean => {
  if (board.robber !== null || board.roads.length > 0 || board.buildings.length > 0) return false
  if (board.hexes.some((hex) => hex.tile !== null || hex.numberToken !== null)) return false
  const defaults = defaultPorts(board.layout)
  return board.ports.length === defaults.length &&
    defaults.every((port) => board.ports.some((candidate) =>
      candidate.edgeId === port.edgeId && candidate.resource === port.resource && candidate.rate === port.rate))
}

// Wipe tiles, tokens, pieces, and the robber back to a fresh board, keeping the
// current layout and roster. Clearing an already-blank board is a no-op, and
// has to be caught here: setLayout cannot short-circuit on a matching layout,
// because re-running it is exactly what does the clearing.
export const clearBoard = (board: Board): Board =>
  isBlank(board) ? board : setLayout(board, board.layout)

export function draftOrder(board: Board, rounds = 2): string[] {
  return Array.from({ length: Math.max(0, rounds) }, (_, round) =>
    round % 2 === 0 ? board.players.map((player) => player.id) : [...board.players].reverse().map((player) => player.id),
  ).flat()
}

export const pips = (token: number | null): number => token === null ? 0 : Math.max(0, 6 - Math.abs(7 - token))
export const tokenProbability = (token: number | null): number => pips(token) / 36

export function vertexProduction(board: Board, vertexId: VertexId): Partial<Record<Resource, number>> {
  const touching = new Set(vertexTouchingHexes(vertexId).map(axialKey))
  const result: Partial<Record<Resource, number>> = {}
  for (const hex of board.hexes) {
    if (!touching.has(axialKey(hex.coord)) || !hex.tile || hex.tile === 'desert') continue
    result[hex.tile] = (result[hex.tile] ?? 0) + pips(hex.numberToken)
  }
  return result
}

export function validateBoard(board: Board): Issue[] {
  const issues: Issue[] = []
  const add = (severity: Issue['severity'], code: string, message: string, ref?: string) =>
    issues.push({ severity, code, message, ...(ref ? { ref } : {}) })
  if (board.schemaVersion !== 1) add('error', 'schema-version', 'Unsupported schema version')
  // createBoard seeds a player and removePlayer stops at one, so an empty
  // roster can only arrive via import; the store's active-player fallback
  // relies on this invariant holding at every border.
  if (board.players.length === 0) add('error', 'empty-roster', 'Board has no players')
  if (board.layout !== 'standard4' && board.layout !== 'extension6') {
    add('error', 'layout', 'Unknown board layout')
    return issues
  }
  const grid = boardGrid(board.layout)
  const hexKeys = board.hexes.map((hex) => axialKey(hex.coord))
  if (hexKeys.length !== grid.landCoords.length || new Set(hexKeys).size !== hexKeys.length ||
    hexKeys.some((key) => !grid.landKeys.has(key))) {
    add('error', 'hex-set', 'Hex set does not match the selected layout')
  }
  for (const hex of board.hexes) {
    const ref = axialKey(hex.coord)
    if (hex.tile === 'desert' && hex.numberToken !== null) add('error', 'token-on-desert', 'A desert cannot carry a number token', ref)
    if (hex.numberToken !== null && (!Number.isInteger(hex.numberToken) || hex.numberToken < 2 || hex.numberToken > 12 || hex.numberToken === 7)) {
      add('error', 'bad-token', 'Number token is outside 2 through 12, excluding 7', ref)
    }
    if (hex.tile === null) add('warning', 'unassigned-tile', 'Tile is unassigned', ref)
    else if (hex.tile !== 'desert' && hex.numberToken === null) add('warning', 'missing-token', 'Resource tile has no number token', ref)
  }
  const portEdges = new Set<string>()
  for (const port of board.ports) {
    if (!grid.coastalEdgeIds.includes(port.edgeId)) add('error', 'non-coastal-port', 'Port is not on a coastal edge', port.edgeId)
    if (portEdges.has(port.edgeId)) add('error', 'duplicate-port', 'Multiple ports occupy one edge', port.edgeId)
    portEdges.add(port.edgeId)
    if (!Number.isInteger(port.rate) || port.rate < 2) add('error', 'bad-port-rate', 'Port rate must be an integer of at least 2', port.edgeId)
  }
  const playerIds = new Set(board.players.map((player) => player.id))
  if (board.players.length === 0 || board.players.length > 6 || playerIds.size !== board.players.length) {
    add('error', 'player-count', 'Board must contain one to six players with unique IDs')
  } else if (board.players.length < 2) add('warning', 'few-players', 'Starting analysis normally needs at least two players')
  if (board.mePlayerId !== null && !playerIds.has(board.mePlayerId)) add('error', 'unknown-me', 'Me player is not in the roster')
  const roadEdges = new Set<string>()
  for (const road of board.roads) {
    if (!grid.edgeIds.includes(road.edgeId)) add('error', 'unknown-road-edge', 'Road uses an unknown edge', road.edgeId)
    if (!playerIds.has(road.playerId)) add('error', 'unknown-piece-player', 'Road owner is not in the roster', road.edgeId)
    if (roadEdges.has(road.edgeId)) add('error', 'duplicate-road', 'Multiple roads occupy one edge', road.edgeId)
    roadEdges.add(road.edgeId)
  }
  const buildingVertices = new Set<string>()
  for (const building of board.buildings) {
    if (!grid.vertexIds.includes(building.vertexId)) add('error', 'unknown-building-vertex', 'Building uses an unknown vertex', building.vertexId)
    if (!playerIds.has(building.playerId)) add('error', 'unknown-piece-player', 'Building owner is not in the roster', building.vertexId)
    if (buildingVertices.has(building.vertexId)) add('error', 'duplicate-building', 'Multiple buildings occupy one vertex', building.vertexId)
    buildingVertices.add(building.vertexId)
  }
  if (board.robber === null) add('warning', 'missing-robber', 'Robber has not been placed')
  else if (!grid.landKeys.has(axialKey(board.robber))) add('error', 'robber-off-land', 'Robber is not on a land hex')
  for (const building of board.buildings) {
    if (vertexAdjacentVertexIds(building.vertexId).some((id) => buildingVertices.has(id))) {
      add('warning', 'adjacent-buildings', 'Buildings occupy adjacent vertices', building.vertexId)
    }
  }
  return issues
}

export const isResource = (value: unknown): value is Resource =>
  typeof value === 'string' && (RESOURCES as readonly string[]).includes(value)
