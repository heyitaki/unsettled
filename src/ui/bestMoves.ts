import type { AdviceAction, Cards, Decision, PreRollPlay, ScoredAdvice } from '../engine/advice/protocol'
import { validateBoard } from '../model/board'
import { axialKey, hexVertexIds, parseEdgeId, parseVertexId } from '../model/coords'
import { DEV_KINDS, emptyStats, type Game, type PlayerStats } from '../model/game'
import { activePlayerId, CARD_COSTS, endTurn, handTotal, recordBankTrade, recordBuild, recordBuyDev, recordPlayDev, turnState } from '../model/turn'
import { RESOURCES, type AxialCoord, type Board, type Resource } from '../model/types'
import { buildingSlots, roadSlots } from './placementSlots'
import type { HighlightMark } from './store'

export const DEV_LABELS = { knight: 'Knight', roadBuilding: 'Road building', yearOfPlenty: 'Year of plenty', monopoly: 'Monopoly' } as const
export type Move = AdviceAction | PreRollPlay
export type AdviceInput =
  | { open: 'trade'; fill: Extract<AdviceAction, { type: 'offerTrade' }> }
  | { open: 'buy'; fill: Extract<AdviceAction, { type: 'buyDev' }> }
  | { open: 'play'; fill: Extract<PreRollPlay, { type: 'playKnight' | 'monopoly' }> }
interface TradeCards { resource: Resource; count: number }

export function limitTradeOffers(actions: readonly ScoredAdvice[]): ScoredAdvice[] {
  const offers = actions.map((advice, index) => ({ ...advice, index })).filter(({ action }) => action.type === 'offerTrade')
  const keep = new Set(offers.sort((a, b) => b.score - a.score).slice(0, 3).map(({ index }) => index))
  return actions.filter(({ action }, index) => action.type !== 'offerTrade' || keep.has(index))
}

export function adviceBlockers(board: Board): string[] {
  // The engine refuses these boards even though the editor permits them while a game is being entered.
  const warnings = new Set(['unassigned-tile', 'missing-token', 'few-players', 'adjacent-buildings'])
  if (!board.hexes.some((hex) => hex.tile === 'desert')) warnings.add('missing-robber')
  const groups = new Map<string, { message: string; count: number }>()
  for (const issue of validateBoard(board)) {
    if (issue.severity !== 'error' && !warnings.has(issue.code)) continue
    const group = groups.get(issue.code)
    if (group) group.count += 1
    else groups.set(issue.code, { message: issue.message, count: 1 })
  }
  return [...groups].map(([code, { message, count }]) => {
    switch (code) {
      case 'unassigned-tile': return `${count} ${count === 1 ? 'hex has' : 'hexes have'} no tile`
      case 'missing-token': return `${count} resource ${count === 1 ? 'hex has' : 'hexes have'} no number`
      case 'few-players': return 'Add a second player'
      case 'missing-robber': return 'Place the robber'
      case 'adjacent-buildings': return `${count === 2 ? 'Two' : count} buildings sit on adjacent corners`
      default: return count === 1 ? message : `${message} (${count} instances)`
    }
  })
}

export function statsFor(game: Game, playerId: string): PlayerStats {
  return Object.hasOwn(game.stats, playerId) ? game.stats[playerId] : emptyStats()
}

/** The claimed player's dev cards by type, or null for anyone whose types are not known. */
export function typedDevHand(game: Game, playerId: string) {
  return playerId === game.board.mePlayerId && game.devHand?.playerId === playerId ? game.devHand : null
}

export function couldAfford(stats: PlayerStats, cost: Partial<Cards>): boolean {
  return RESOURCES.reduce((missing, resource) => missing + Math.max(0, (cost[resource] ?? 0) - stats.hand[resource]), 0) <= stats.handUnknown
}

export function buildablePieces(game: Game, playerId: string) {
  const { board } = game
  const stats = statsFor(game, playerId)

  // Match the base per-player supplies in simulator/crates/engine/src/rules.rs.
  const limits = { road: 15, settlement: 5, city: 4 }
  return (['road', 'settlement', 'city'] as const).filter((piece) => {
    if (!couldAfford(stats, CARD_COSTS[piece])) return false
    const placed = piece === 'road' ? board.roads.filter((road) => road.playerId === playerId).length
      : board.buildings.filter((building) => building.playerId === playerId && building.tier === piece).length
    return placed < limits[piece] && (piece === 'road'
      ? roadSlots(board, playerId).length > 0
      : buildingSlots(board, playerId, piece, 'build').length > 0)
  })
}

export function availableActions(game: Game, playerId: string, devDeckRemaining?: number) {
  const stats = statsFor(game, playerId)
  const typed = typedDevHand(game, playerId)
  const turn = turnState(game)
  return {
    trade: handTotal(stats) > 0,
    buy: couldAfford(stats, CARD_COSTS.devCard) && devDeckRemaining !== 0,
    play: !turn?.devPlayed && (typed ? DEV_KINDS.some((kind) => typed.playable[kind] > 0)
      : stats.devCards - (turn?.devBought ?? 0) > 0),
    build: buildablePieces(game, playerId).length > 0,
  }
}

export function robberPending(game: Game): boolean {
  return game.turn?.rolled === 7 && game.turn.robberMoved === false
}

export function robberCandidates(game: Game, hex: AxialCoord, moverId: string): string[] {
  const corners = new Set(hexVertexIds(hex))
  return game.board.players.filter(({ id }) => id !== moverId && handTotal(statsFor(game, id)) > 0 &&
    game.board.buildings.some((building) => building.playerId === id && corners.has(building.vertexId)))
    .map(({ id }) => id)
}

export function cardRange(stats: PlayerStats, resource: Resource, exact: boolean) {
  return { lo: stats.hand[resource], hi: stats.hand[resource] + (exact ? 0 : stats.handUnknown) }
}

export function discardInputCards(mine: boolean, advised?: Cards): Cards {
  return mine && advised ? { ...advised } : emptyStats().hand
}

export function hexLabel(coord: AxialCoord, board: Board): string {
  const hex = board.hexes.find((hex) => axialKey(hex.coord) === axialKey(coord))
  if (!hex || hex.tile === null) return 'Unassigned'
  if (hex.tile === 'desert') return 'Desert'
  return `${hex.tile} ${hex.numberToken ?? '?'}`
}

function spotLabel(coords: AxialCoord[], board: Board): string {
  const land = new Set(board.hexes.map((hex) => axialKey(hex.coord)))
  return coords.filter((coord) => land.has(axialKey(coord))).map((coord) => hexLabel(coord, board)).join(' · ')
}

export function actionLabel(action: AdviceAction, board: Board): string {
  switch (action.type) {
    case 'buildRoad': return `Build road toward ${spotLabel(parseEdgeId(action.edgeId), board)}`
    case 'buildSettlement': return `Build settlement · ${spotLabel(parseVertexId(action.vertexId), board)}`
    case 'upgradeCity': return `Upgrade to city · ${spotLabel(parseVertexId(action.vertexId), board)}`
    case 'buyDev': return 'Buy a development card'
    case 'playKnight': return playLabel(action, board)
    case 'tradeBank': return `Trade ${action.rate * action.count} ${action.give} for ${action.count} ${action.get} with the bank`
    case 'offerTrade': return `Offer ${action.count} ${action.give} for 1 ${action.get}`
    case 'pass': return 'Pass'
  }
}

export function recordedMoveLabel(move: Move): string {
  switch (move.type) {
    case 'buildRoad': return 'Built a road'
    case 'buildSettlement': return 'Built a settlement'
    case 'upgradeCity': return 'Built a city'
    case 'buyDev': return 'Bought a dev card'
    case 'tradeBank': return `Traded ${move.rate * move.count} ${move.give} for ${move.count} ${move.get} with ${move.rate < 4 ? `a ${move.rate}:1 port` : 'the bank'}`
    case 'roadBuilding': {
      const count = [move.first, move.second].filter((edge) => edge !== null).length
      return `Played Road building · ${count} ${count === 1 ? 'road' : 'roads'}`
    }
    case 'yearOfPlenty': return `Played Year of plenty · ${move.first} and ${move.second}`
    case 'pass': return 'Ended turn'
    case 'playKnight': return 'Played Knight'
    case 'monopoly': return `Played Monopoly on ${move.resource}`
    case 'offerTrade': return `Offered ${move.count} ${move.give} for 1 ${move.get}`
  }
}

export function playLabel(play: PreRollPlay, board: Board): string {
  switch (play.type) {
    case 'playKnight': {
      const victim = board.players.find((player) => player.id === play.victim)?.name ?? play.victim
      return `Play Knight: robber to ${hexLabel(play.hex, board)}, ${play.victim === null ? 'rob nobody' : `steal from ${victim}`}`
    }
    case 'roadBuilding': {
      const edges = [play.first, play.second]
      const spots = edges.flatMap((edge) => edge === null ? [] : [spotLabel(parseEdgeId(edge), board)]).join(' / ')
      return `Play Road building${edges.some(Boolean) ? ` · ${spots}` : ''}`
    }
    case 'yearOfPlenty': return `Play Year of plenty: take ${play.first} and ${play.second}`
    case 'monopoly': return `Play Monopoly: name ${play.resource}`
  }
}

export function adviceMarks(action: Move, color: string): HighlightMark[] {
  if ('hex' in action) return [{ ref: axialKey(action.hex), color, kind: 'hex' }]
  if ('vertexId' in action) return [{ ref: action.vertexId, color }]
  if ('edgeId' in action) return [{ ref: action.edgeId, color, kind: 'road' }]
  if (action.type === 'roadBuilding') return [action.first, action.second].flatMap((ref) => ref === null ? [] : [{ ref, color, kind: 'road' as const }])
  return []
}

export function applyAdvice(game: Game, action: Move): Game | AdviceInput {
  switch (action.type) {
    case 'buildRoad': return recordBuild(game, 'road', action.edgeId)
    case 'buildSettlement': return recordBuild(game, 'settlement', action.vertexId)
    case 'upgradeCity': return recordBuild(game, 'city', action.vertexId)
    case 'tradeBank': return recordBankTrade(game, action.give, action.rate * action.count, action.get, action.count)
    case 'pass': return endTurn(game)
    case 'yearOfPlenty': return recordPlayDev(game, { kind: 'yearOfPlenty', resources: [action.first, action.second] })
    case 'roadBuilding': {
      const edges = action.first === null ? (action.second === null ? [] as const : [action.second] as const)
        : action.second === null ? [action.first] as const : [action.first, action.second] as const
      return recordPlayDev(game, { kind: 'roadBuilding', edges })
    }
    case 'buyDev': return activePlayerId(game) === game.board.mePlayerId ? { open: 'buy', fill: action } : recordBuyDev(game, null)
    case 'offerTrade': return { open: 'trade', fill: action }
    case 'playKnight':
    case 'monopoly': return { open: 'play', fill: action }
  }
}

export function tradeVerdictRequest(
  game: Game,
  activeId: string,
  otherId: string | null,
  gives: TradeCards,
  gets: TradeCards,
): Extract<Decision, { kind: 'tradeResponse' }> | null {
  const me = game.board.mePlayerId
  if (me === null || otherId === null || otherId === activeId || !game.board.players.some((player) => player.id === otherId)) return null
  if (me !== activeId && me !== otherId) return null
  const [paid, received] = me === activeId ? [gives, gets] : [gets, gives]
  if (paid.count !== 1 || (received.count !== 1 && received.count !== 2) || paid.resource === received.resource) return null
  return { kind: 'tradeResponse', proposer: me === activeId ? otherId : activeId, give: received.resource, get: paid.resource, count: received.count }
}

export function sevenDiscards(game: Game) {
  return game.board.players.flatMap(({ id }) => {
    const total = handTotal(statsFor(game, id))
    return total > 7 ? [{ playerId: id, total, count: Math.floor(total / 2) }] : []
  })
}
