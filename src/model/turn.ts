import { placeBuilding, placeRoad, setRobber, setupGrants } from './board'
import { edgeEndpointVertexIds } from './coords'
import {
  adjustCounter, DEV_KINDS, devHandTotal, ensureStats, withBoard,
  type DevHand, type DevKind, type Game, type PlayerStats, type TurnState,
} from './game'
import { RESOURCES, type AxialCoord, type Board, type EdgeId, type Resource, type VertexId } from './types'

type Cards = Partial<Record<Resource, number>>

export const CARD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
} as const satisfies Record<'road' | 'settlement' | 'city' | 'devCard', Cards>

export type DevPlay =
  | { kind: 'knight'; hex: AxialCoord; victimId: string | null; stolen: Resource | null }
  | { kind: 'roadBuilding'; edges: readonly [] | readonly [EdgeId] | readonly [EdgeId, EdgeId] }
  | { kind: 'yearOfPlenty'; resources: readonly [Resource, Resource] }
  | { kind: 'monopoly'; resource: Resource; taken: Record<string, number> }

export function activePlayerId(game: Game): string | null {
  return game.turn?.playerId ?? game.board.mePlayerId
}

export function awaitingFirstTurn(game: Game): boolean {
  return game.turn === undefined && setupGrants(game.board) !== null
}

export function turnState(game: Game): TurnState | null {
  if (game.turn) return game.turn
  const playerId = activePlayerId(game)
  return playerId === null ? null : {
    playerId, rolled: null, devPlayed: false,
    progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
  }
}

export function setActivePlayer(game: Game, playerId: string): Game {
  ensureStats(game, playerId)
  if (game.turn?.playerId === playerId) return game
  const progressPlayed = turnState(game)?.progressPlayed ?? { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  return {
    ...(activePlayerId(game) === playerId ? game : promoteBought(game)),
    turn: { playerId, rolled: null, devPlayed: false, progressPlayed },
  }
}

export function endTurn(game: Game): Game {
  const turn = requireTurn(game)
  const index = game.board.players.findIndex((player) => player.id === turn.playerId)
  if (index < 0) throw new RangeError(`Unknown player ${turn.playerId}`)
  const playerId = game.board.players[(index + 1) % game.board.players.length].id
  return { ...promoteBought(game), turn: { ...turn, playerId, rolled: null, devPlayed: false } }
}

export function recordRoll(game: Game, total: number, gains: Record<string, Record<Resource, number>>): Game {
  if (!Number.isInteger(total) || total < 2 || total > 12) throw new RangeError('Roll must be an integer from 2 to 12')
  let next: Game = { ...game, turn: { ...requireTurn(game), rolled: total } }
  for (const [playerId, cards] of Object.entries(gains)) next = gain(next, playerId, cards)
  return next
}

export function recordDiscard(game: Game, playerId: string, cards: Cards | number): Game {
  return typeof cards === 'number' ? loseUnseen(game, playerId, cards) : spend(game, playerId, cards)
}

export function recordRobber(game: Game, hex: AxialCoord, victimId: string | null, stolen: Resource | null): Game {
  let next = withBoard(game, setRobber(game.board, hex))
  if (victimId === null) return next
  const { playerId } = requireTurn(game)
  if (handTotal(ensureStats(game, victimId)) === 0) return next
  if (stolen === null) {
    next = loseUnseen(next, victimId, 1)
    return adjustCounter(next, playerId, 'handUnknown', 1)
  }
  next = spend(next, victimId, { [stolen]: 1 })
  return gain(next, playerId, { [stolen]: 1 })
}

export function bankRate(board: Board, playerId: string, resource: Resource): number {
  const owned = new Set(board.buildings.filter((building) => building.playerId === playerId).map((building) => building.vertexId))
  return board.ports.reduce((rate, port) => (port.resource === null || port.resource === resource)
    && edgeEndpointVertexIds(port.edgeId).some((vertex) => owned.has(vertex)) ? Math.min(rate, port.rate) : rate, 4)
}

export function recordBankTrade(game: Game, give: Resource, giveCount: number, get: Resource, getCount: number): Game {
  const { playerId } = requireTurn(game)
  return gain(spend(game, playerId, { [give]: giveCount }), playerId, { [get]: getCount })
}

export function recordPlayerTrade(game: Game, otherId: string, gives: Cards, gets: Cards): Game {
  const { playerId } = requireTurn(game)
  if (otherId === playerId) throw new RangeError('Cannot trade with the active player')
  let next = spend(game, playerId, gives)
  next = spend(next, otherId, gets)
  next = gain(next, playerId, gets)
  return gain(next, otherId, gives)
}

export function recordBuild(game: Game, piece: 'road' | 'settlement' | 'city', id: EdgeId | VertexId, options?: { free?: boolean }): Game {
  const { playerId } = requireTurn(game)
  const board = piece === 'road'
    ? placeRoad(game.board, id as EdgeId, playerId)
    : placeBuilding(game.board, id as VertexId, playerId, piece)
  if (board === game.board) return game
  const next = withBoard(game, board)
  return options?.free ? next : spend(next, playerId, CARD_COSTS[piece])
}

export function recordBuyDev(game: Game, drawn: DevKind | 'vp' | null): Game {
  const { playerId } = requireTurn(game)
  let next = spend(game, playerId, CARD_COSTS.devCard)
  if (drawn === 'vp') return adjustCounter(next, playerId, 'vpCards', 1)
  next = adjustCounter(next, playerId, 'devCards', 1)
  if (playerId === game.board.mePlayerId && drawn !== null) {
    const devHand = devHandFor(game, playerId)
    next = { ...next, devHand: { ...devHand, bought: { ...devHand.bought, [drawn]: devHand.bought[drawn] + 1 } } }
  }
  return next
}

export function recordPlayDev(game: Game, play: DevPlay): Game {
  const turn = requireTurn(game)
  const { playerId } = turn
  let next = game
  switch (play.kind) {
    case 'knight':
      next = recordRobber(next, play.hex, play.victimId, play.stolen)
      next = adjustCounter(next, playerId, 'knights', 1)
      break
    case 'roadBuilding':
      for (const edge of play.edges) next = recordBuild(next, 'road', edge, { free: true })
      break
    case 'yearOfPlenty':
      for (const resource of play.resources) next = gain(next, playerId, { [resource]: 1 })
      break
    case 'monopoly': {
      let total = 0
      for (const [otherId, count] of Object.entries(play.taken)) {
        next = spend(next, otherId, { [play.resource]: count })
        total += count
      }
      next = gain(next, playerId, { [play.resource]: total })
      break
    }
  }
  if (next.devHand?.playerId === playerId) {
    const devHand = next.devHand
    const list = devHand.playable[play.kind] > 0 ? 'playable' : 'bought'
    next = { ...next }

    // A recorded play of an unlisted kind means the entered types no longer explain the public count.
    if (devHand[list][play.kind] === 0) delete next.devHand
    else next.devHand = { ...devHand, [list]: { ...devHand[list], [play.kind]: devHand[list][play.kind] - 1 } }
  }
  next = adjustCounter(next, playerId, 'devCards', -1)
  const progressPlayed = play.kind === 'knight'
    ? turn.progressPlayed
    : { ...turn.progressPlayed, [play.kind]: turn.progressPlayed[play.kind] + 1 }
  return { ...next, turn: { ...turn, devPlayed: true, progressPlayed } }
}

export function adjustDevHand(game: Game, list: 'playable' | 'bought', kind: DevKind, delta: number): Game {
  const playerId = game.board.mePlayerId
  if (playerId === null) throw new RangeError('No claimed player')
  const stats = ensureStats(game, playerId)
  const current = devHandFor(game, playerId)
  const devHand = { ...current, [list]: { ...current[list], [kind]: Math.max(0, current[list][kind] + delta) } }
  const devCards = devHandTotal(devHand)
  return { ...withStats(game, playerId, { ...stats, devCards }), devHand }
}

function devHandFor(game: Game, playerId: string): DevHand {
  return game.devHand?.playerId === playerId
    ? game.devHand
    : { playerId, playable: emptyDevCounts(), bought: emptyDevCounts() }
}

function emptyDevCounts(): Record<DevKind, number> {
  return { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
}

function gain(game: Game, playerId: string, cards: Cards): Game {
  const stats = ensureStats(game, playerId)
  const hand = { ...stats.hand }
  for (const resource of RESOURCES) hand[resource] += cards[resource] ?? 0
  return withStats(game, playerId, { ...stats, hand })
}

export function handTotal(stats: PlayerStats): number {
  return RESOURCES.reduce((sum, resource) => sum + stats.hand[resource], stats.handUnknown)
}

function loseUnseen(game: Game, playerId: string, count: number): Game {
  const stats = ensureStats(game, playerId)
  const hand = { ...stats.hand }
  let total = handTotal(stats)
  let handUnknown = stats.handUnknown
  for (let lost = 0; lost < count && total > 0; lost += 1) {
    let known = 0

    // Any resource could be the missing card, so every known lower bound falls.
    for (const resource of RESOURCES) {
      hand[resource] = Math.max(0, hand[resource] - 1)
      known += hand[resource]
    }
    total -= 1
    handUnknown = total - known
  }
  return withStats(game, playerId, { ...stats, hand, handUnknown })
}

function promoteBought(game: Game): Game {
  const hand = game.devHand
  if (!hand || hand.playerId !== activePlayerId(game) || !DEV_KINDS.some((kind) => hand.bought[kind] > 0)) return game
  const playable = { ...hand.playable }
  for (const kind of DEV_KINDS) playable[kind] += hand.bought[kind]
  return { ...game, devHand: { ...hand, playable, bought: emptyDevCounts() } }
}

function requireTurn(game: Game): TurnState {
  const turn = turnState(game)
  if (!turn) throw new RangeError('No active player')
  ensureStats(game, turn.playerId)
  return turn
}

function spend(game: Game, playerId: string, cards: Cards): Game {
  const stats = ensureStats(game, playerId)
  const hand = { ...stats.hand }
  let handUnknown = stats.handUnknown
  for (const resource of RESOURCES) {
    const count = cards[resource] ?? 0
    handUnknown = Math.max(0, handUnknown - Math.max(0, count - hand[resource]))
    hand[resource] = Math.max(0, hand[resource] - count)
  }
  return withStats(game, playerId, { ...stats, hand, handUnknown })
}

function withStats(game: Game, playerId: string, stats: PlayerStats): Game {
  return { ...game, stats: { ...game.stats, [playerId]: stats } }
}
