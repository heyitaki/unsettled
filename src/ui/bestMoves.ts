import type { AdviceAction, Cards, Decision, KnightPlay, PreRollPlay, ScoredAdvice } from '../engine/advice/protocol'
import { validateBoard } from '../model/board'
import { axialKey, hexVertexIds, parseEdgeId, parseVertexId } from '../model/coords'
import { DEV_KINDS, emptyStats, unseenCards, type Correction, type CorrectionField, type Game, type PlayerStats } from '../model/game'
import { historyPlayer } from '../model/history'
import { activePlayerId, CARD_COSTS, endTurn, handTotal, recordBankTrade, recordBuild, recordBuyDev, recordPlayDev, turnState } from '../model/turn'
import { RESOURCES, type AxialCoord, type Board, type Resource } from '../model/types'
import { buildingSlots, roadSlots } from './placementSlots'
import type { HighlightMark } from './store'
import { hexParts, partsDescription, RESOURCE_LABELS, vertexParts, type VertexPart } from './vertexParts'

export const DEV_LABELS = { knight: 'Knight', roadBuilding: 'Road building', yearOfPlenty: 'Year of plenty', monopoly: 'Monopoly' } as const
export type Move = AdviceAction | PreRollPlay
export type AdviceInput =
  | { open: 'trade'; fill: Extract<AdviceAction, { type: 'offerTrade' }> }
  | { open: 'buy'; fill: Extract<AdviceAction, { type: 'buyDev' }> }
  | { open: 'play'; fill: Extract<PreRollPlay, { type: 'playKnight' | 'monopoly' }> }
interface TradeCards { resource: Resource; count: number }

export function correctionLine(board: Board, correction: Correction): string {
  const labels: Record<CorrectionField, string> = {
    ...RESOURCE_LABELS, ...DEV_LABELS, handUnknown: 'Unseen cards', devCards: 'Unknown dev cards',
    knights: 'Knights played', vpCards: 'Victory points',
  }
  const parts = Object.entries(correction.changes).map(([playerId, fields]) => {
    const changes = Object.entries(fields).map(([field, delta]) =>
      `${labels[field as CorrectionField].toLowerCase()} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`)
    return `${historyPlayer(board, playerId).name}: ${changes.join(', ')}`
  })
  for (const [kind, playerId] of Object.entries(correction.awards ?? {})) {
    const award = `${kind === 'longestRoad' ? 'longest road' : 'largest army'} to ${historyPlayer(board, playerId).name}`
    parts.push(parts.length ? capitalize(award) : award)
  }
  return `Corrected ${parts.join(' · ')}`
}

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

export function buildablePieces(game: Game, playerId: string) {
  const { board } = game
  const stats = statsFor(game, playerId)

  // Match the base per-player supplies in simulator/crates/engine/src/rules.rs.
  const limits = { road: 15, settlement: 5, city: 4 }
  return (['road', 'settlement', 'city'] as const).filter((piece) => {
    if (!canCover(stats, CARD_COSTS[piece])) return false
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
    buy: canCover(stats, CARD_COSTS.devCard) && devDeckRemaining !== 0,
    play: !turn?.devPlayed && (typed ? DEV_KINDS.some((kind) => typed.playable[kind] > 0)
      : stats.devCards - (turn?.devBought ?? 0) > 0),
    build: buildablePieces(game, playerId).length > 0,
  }
}

export function robberPending(game: Game): boolean {
  return game.turn?.rolled === 7 && game.turn.robberMoved === false
}

/** Every rival with a building on `hex`, whether or not they hold a card to steal. */
export function robberNeighbours(game: Game, hex: AxialCoord, moverId: string): string[] {
  const corners = new Set(hexVertexIds(hex))
  return game.board.players.filter(({ id }) => id !== moverId &&
    game.board.buildings.some((building) => building.playerId === id && corners.has(building.vertexId)))
    .map(({ id }) => id)
}

export function robberCandidates(game: Game, hex: AxialCoord, moverId: string): string[] {
  return robberNeighbours(game, hex, moverId).filter((id) => handTotal(statsFor(game, id)) > 0)
}

export function cardRange(stats: PlayerStats, resource: Resource, exact: boolean) {
  const unseen = exact ? 0 : unseenCards(stats).filter((card) => card.includes(resource)).length
  return { lo: stats.hand[resource], hi: stats.hand[resource] + unseen }
}

/**
 * Whether the hand could hold `cards`: the unseen cards must cover every shortfall, each card one
 * of its possible types. By Hall's theorem that holds when, for every set of short types, the
 * cards that could be one of them are at least as many as the cards missing.
 */
export function canCover(stats: PlayerStats, cards: Partial<Cards>): boolean {
  const short = RESOURCES.map((resource) => Math.max(0, (cards[resource] ?? 0) - stats.hand[resource]))
  const unseen = unseenCards(stats)
  for (let mask = 1; mask < 1 << RESOURCES.length; mask += 1) {
    const types = RESOURCES.filter((_, index) => mask & 1 << index)
    const missing = types.reduce((sum, type) => sum + short[RESOURCES.indexOf(type)], 0)
    if (missing > unseen.filter((card) => card.some((type) => types.includes(type))).length) return false
  }
  return true
}

export function discardInputCards(mine: boolean, advised?: Cards): Cards {
  return mine && advised ? { ...advised } : emptyStats().hand
}

/** Text after a ` · ` starts with a capital, so a resource that opens a part is capitalized. */
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function hexLabel(coord: AxialCoord, board: Board): string {
  const hex = board.hexes.find((hex) => axialKey(hex.coord) === axialKey(coord))
  if (!hex || hex.tile === null) return 'Unassigned'
  if (hex.tile === 'desert') return 'Desert'
  return `${capitalize(hex.tile)} ${hex.numberToken ?? '?'}`
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
    case 'tradeBank': return `Traded ${move.rate * move.count} ${move.give} to the ${move.rate < 4 ? 'port' : 'bank'} for ${move.count} ${move.get}`
    case 'roadBuilding': {
      const count = [move.first, move.second].filter((edge) => edge !== null).length
      return `Played Road building · ${count} ${count === 1 ? 'road' : 'roads'}`
    }
    case 'yearOfPlenty': return `Played Year of plenty · ${capitalize(move.first)} and ${move.second}`
    case 'pass': return 'Ended turn'
    case 'playKnight': return 'Played Knight'
    case 'monopoly': return `Played Monopoly on ${move.resource}`
    case 'offerTrade': return `Offered ${move.count} ${move.give} for 1 ${move.get}`
  }
}

export function knightTheft(play: Pick<KnightPlay, 'victim'>, board: Board): string {
  if (play.victim === null) return 'rob nobody'
  return `steal from ${board.players.find((player) => player.id === play.victim)?.name ?? play.victim}`
}

export function playLabel(play: PreRollPlay, board: Board): string {
  switch (play.type) {
    case 'playKnight': return `Play Knight: robber to ${hexLabel(play.hex, board)}, ${knightTheft(play, board)}`
    case 'roadBuilding': {
      const edges = [play.first, play.second]
      const spots = edges.flatMap((edge) => edge === null ? [] : [spotLabel(parseEdgeId(edge), board)]).join(' / ')
      return `Play Road building${edges.some(Boolean) ? ` · ${spots}` : ''}`
    }
    case 'yearOfPlenty': return `Play Year of plenty: take ${play.first} and ${play.second}`
    case 'monopoly': return `Play Monopoly: name ${play.resource}`
  }
}

/** A move's place on the board and its title without that place, for the moves `moveSpot` draws. */
function placeOf(move: Move, board: Board): { parts: VertexPart[]; title: string } | null {
  switch (move.type) {
    case 'buildSettlement': return { parts: vertexParts(board, move.vertexId), title: 'Build settlement' }
    case 'upgradeCity': return { parts: vertexParts(board, move.vertexId), title: 'Upgrade to city' }
    case 'buildRoad': return { parts: hexParts(board, parseEdgeId(move.edgeId)), title: 'Build road' }
    case 'playKnight': return { parts: hexParts(board, [move.hex]), title: `Play Knight: ${knightTheft(move, board)}` }
    case 'roadBuilding': {
      const hexes = [move.first, move.second].flatMap((edge) => edge === null ? [] : parseEdgeId(edge))
      return { parts: hexParts(board, hexes), title: 'Play Road building' }
    }
    default: return null
  }
}

/** The hexes a move is placed on, drawn as tiles the way Best picks draws a spot: `label` names them for the tiles' accessible name and `title` is the move's label without the place. Null for a move with no place on the board. */
export function moveSpot(move: Move, board: Board): { parts: VertexPart[]; label: string; title: string } | null {
  const place = placeOf(move, board)
  return place && place.parts.length > 0 ? { ...place, label: partsDescription(place.parts) } : null
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
    case 'tradeBank': return recordBankTrade(game, { [action.give]: action.rate * action.count }, { [action.get]: action.count })
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
