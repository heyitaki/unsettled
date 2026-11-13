import type { Game, GameHistory, PlayerStats, Position, TurnRecord, TurnState } from './game'
import { RESOURCES, type Board, type EdgeId, type Player, type VertexId } from './types'

const REMOVED_PLAYER = { name: 'Removed player', color: '#c5bfb5' }

/** A recorded turn can name a player since removed from the roster. */
export function historyPlayer(board: Board, playerId: string | undefined): Pick<Player, 'name' | 'color'> {
  return board.players.find((player) => player.id === playerId) ?? REMOVED_PLAYER
}

export function positionOf(game: Game): Position {
  return {
    buildings: game.board.buildings,
    roads: game.board.roads,
    robber: game.board.robber,
    stats: game.stats,
    ...(game.awards === undefined ? {} : { awards: game.awards }),
    ...(game.devHand === undefined ? {} : { devHand: game.devHand }),
  }
}

function foldPosition(history: GameHistory, index: number): Position {
  const buildings = new Map(history.start.buildings.map((piece) => [piece.vertexId, piece]))
  const roads = new Map(history.start.roads.map((piece) => [piece.edgeId, piece]))
  const stats = { ...history.start.stats }
  for (const record of history.turns.slice(0, index)) {
    for (const [id, playerStats] of Object.entries(record.stats ?? {})) {
      if (playerStats === null) delete stats[id]
      else stats[id] = playerStats
    }
    for (const [id, building] of Object.entries(record.buildings ?? {})) {
      if (building === null) buildings.delete(id as VertexId)
      else buildings.set(building.vertexId, building)
    }
    for (const [id, owner] of Object.entries(record.roads ?? {})) {
      const edgeId = id as EdgeId
      if (owner === null) roads.delete(edgeId)
      else roads.set(edgeId, { edgeId, playerId: owner })
    }
  }
  const position = index === 0 ? history.start : history.turns[index - 1]
  return {
    buildings: [...buildings.values()], roads: [...roads.values()], robber: position.robber, stats,
    ...(position.awards === undefined ? {} : { awards: position.awards }),
    ...(position.devHand === undefined ? {} : { devHand: position.devHand }),
  }
}

export function historyGame(game: Game, index: number): Game {
  if (!game.history) return game
  if (!Number.isInteger(index) || index < 0 || index > game.history.turns.length) throw new RangeError('Unknown history turn')
  const { buildings, roads, robber, stats, awards, devHand } = foldPosition(game.history, index)
  const next: Game = { ...game, board: { ...game.board, buildings, roads, robber }, stats }
  if (awards === undefined) delete next.awards
  else next.awards = awards
  if (devHand === undefined) delete next.devHand
  else next.devHand = devHand
  if (index > 0 && game.turn) {
    const record = game.history.turns[index - 1]
    next.turn = { ...game.turn, playerId: record.playerId, rolled: record.rolled }
    delete next.turn.log
    delete next.turn.gains
  }
  return next
}

export function turnRecord(game: Game, history: GameHistory, turn: TurnState): TurnRecord {
  const previous = foldPosition(history, history.turns.length)
  const { buildings, roads, stats, ...position } = positionOf(game)
  const oldBuildings = new Map(previous.buildings.map((piece) => [piece.vertexId, piece]))
  const oldRoads = new Map(previous.roads.map((piece) => [piece.edgeId, piece.playerId]))
  const buildingDiff: NonNullable<TurnRecord['buildings']> = {}
  const roadDiff: NonNullable<TurnRecord['roads']> = {}
  for (const building of buildings) {
    const old = oldBuildings.get(building.vertexId)
    if (!old || old.playerId !== building.playerId || old.tier !== building.tier) buildingDiff[building.vertexId] = building
    oldBuildings.delete(building.vertexId)
  }
  for (const id of oldBuildings.keys()) buildingDiff[id] = null
  for (const road of roads) {
    if (oldRoads.get(road.edgeId) !== road.playerId) roadDiff[road.edgeId] = road.playerId
    oldRoads.delete(road.edgeId)
  }
  for (const id of oldRoads.keys()) roadDiff[id] = null
  const statsDiff: NonNullable<TurnRecord['stats']> = {}
  for (const [id, playerStats] of Object.entries(stats)) {
    if (!sameStats(previous.stats[id], playerStats)) statsDiff[id] = playerStats
  }
  for (const id of Object.keys(previous.stats)) if (!Object.hasOwn(stats, id)) statsDiff[id] = null
  return {
    ...position, playerId: turn.playerId, rolled: turn.rolled, log: turn.log ?? [],
    ...(turn.gains === undefined ? {} : { gains: turn.gains }),
    ...(Object.keys(buildingDiff).length ? { buildings: buildingDiff } : {}),
    ...(Object.keys(roadDiff).length ? { roads: roadDiff } : {}),
    ...(Object.keys(statsDiff).length ? { stats: statsDiff } : {}),
  }
}

function sameStats(a: PlayerStats | undefined, b: PlayerStats): boolean {
  return a !== undefined && a.handUnknown === b.handUnknown && a.devCards === b.devCards && a.knights === b.knights &&
    a.vpCards === b.vpCards && RESOURCES.every((resource) => a.hand[resource] === b.hand[resource])
}

export function turnSummary(log: readonly string[]): string {
  const parts: string[] = []
  const roads = log.filter((line) => line === 'Built a road').length
  for (const line of log) {
    if (!line) continue
    if (line === 'Built a road') {
      const summary = roads === 1 ? 'built a road' : `built ${roads} roads`
      if (!parts.includes(summary)) parts.push(summary)
      continue
    }
    const played = /^Played (Knight|Monopoly|Year of plenty|Road building)\b/.exec(line)
    const robbed = /\bstole from (.+?)(?: · |$)/i.exec(line)
    const traded = /^Traded .+ to (.+) for /.exec(line)
    if (played) parts.push(`played ${played[1]}`)
    if (robbed) parts.push(`robbed ${robbed[1]}`)
    else if (!played && line.startsWith('Robber to ')) parts.push('moved the robber')
    if (traded) parts.push(`traded with ${traded[1]}`)
    else if (!played && !robbed && !line.startsWith('Robber to ')) parts.push(line[0]?.toLowerCase() + line.slice(1))
  }
  const summary = parts.join(', ')
  return summary ? summary[0].toUpperCase() + summary.slice(1) : ''
}
