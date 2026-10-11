import type { AdviceAction, Cards, Decision, PreRollPlay, ScoredAdvice } from '../engine/advice/protocol'
import { validateBoard } from '../model/board'
import { axialKey, parseEdgeId, parseVertexId } from '../model/coords'
import { emptyStats, type Game, type PlayerStats } from '../model/game'
import { activePlayerId, endTurn, handTotal, recordBankTrade, recordBuild, recordBuyDev, recordPlayDev } from '../model/turn'
import type { AxialCoord, Board, Resource } from '../model/types'
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
