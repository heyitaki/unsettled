import { placeBuilding, placeRoad, setRobber, setupGrants } from './board'
import { edgeEndpointVertexIds } from './coords'
import {
  adjustCounter, DEV_KINDS, devHandTotal, ensureStats, unseenCards, withBoard, withUnseenCards,
  isEmptyCorrection, type AwardKind, type Correction, type CorrectionField, type DevHand, type DevKind, type Game, type PlayerStats, type TurnState,
} from './game'
import { RESOURCES, type AxialCoord, type Board, type EdgeId, type Resource, type VertexId } from './types'
import { positionOf, turnRecord } from './history'

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

/** The entries of an undo history (oldest first, current game last) recorded since the current turn began. */
export function currentTurnHistory(history: readonly Game[]): readonly Game[] {
  const playerId = activePlayerId(history[history.length - 1])
  const turn: Game[] = []
  for (const entry of history.slice(history.findLastIndex((entry) => activePlayerId(entry) !== playerId) + 1)) {
    // Back to unrolled within one turn is Change roll: the roll and every action after it are struck.
    if (turnState(entry)?.rolled == null && turn.length > 0 && turnState(turn[turn.length - 1])?.rolled != null) {
      turn.length = turn.findIndex((game) => turnState(game)?.rolled != null)
    }
    // Change roll recommits the pre-roll game itself, which is already the last entry.
    if (turn[turn.length - 1] !== entry) turn.push(entry)
  }
  return turn
}

export function setActivePlayer(game: Game, playerId: string): Game {
  ensureStats(game, playerId)
  if (game.turn?.playerId === playerId) return game
  const progressPlayed = turnState(game)?.progressPlayed ?? { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  const started = begin(game)
  return {
    ...(activePlayerId(game) === playerId ? started : promoteBought(started)),
    turn: { playerId, rolled: null, devPlayed: false, progressPlayed },
  }
}

export function endTurn(game: Game): Game {
  const turn = requireTurn(game)
  const index = game.board.players.findIndex((player) => player.id === turn.playerId)
  if (index < 0) throw new RangeError(`Unknown player ${turn.playerId}`)
  const playerId = game.board.players[(index + 1) % game.board.players.length].id
  const history = game.history ?? { start: positionOf(game), turns: [] }
  return {
    ...promoteBought(game),
    history: { ...history, turns: [...history.turns, turnRecord(game, history, turn)] },
    turn: { playerId, rolled: null, devPlayed: false, progressPlayed: turn.progressPlayed },
  }
}

export function appendLog(game: Game, text: string): Game {
  game = closeCorrection(begin(game))
  const turn = requireTurn(game)
  return { ...game, turn: { ...turn, log: [...turn.log ?? [], text] } }
}

export function recordCorrection(
  before: Game,
  after: Game,
  change: { playerId: string; field: CorrectionField; delta: number } | { award: AwardKind; playerId: string },
  describe: (correction: Correction) => string,
): Game {
  if (after === before || !before.turn || !after.turn) return after
  const previous = before.turn.correction
  const correction: Correction = { changes: {}, ...previous }
  if ('field' in change) {
    const { playerId, field, delta } = change
    const fields = { ...(Object.hasOwn(correction.changes, playerId) ? correction.changes[playerId] : {}) }
    fields[field] = (fields[field] ?? 0) + delta
    if (fields[field] === 0) delete fields[field]
    correction.changes = { ...correction.changes, [playerId]: fields }
    if (Object.keys(fields).length === 0) delete correction.changes[playerId]
  } else {
    correction.awards = { ...correction.awards, [change.award]: change.playerId }
  }
  // A later tap can move a settled award on, so only awards the game still gives stay in the line.
  if (correction.awards) {
    const awards = Object.fromEntries(Object.entries(correction.awards).filter(([kind, holder]) => after.awards?.[kind as AwardKind] === holder))
    if (Object.keys(awards).length) correction.awards = awards
    else delete correction.awards
  }
  const log = [...after.turn.log ?? []]
  if (previous && !isEmptyCorrection(previous)) log.pop()
  if (!isEmptyCorrection(correction)) log.push(describe(correction))
  return { ...after, turn: { ...after.turn, correction, log } }
}

/** Ends an open correction run, keeping its line. */
export function closeCorrection(game: Game): Game {
  if (!game.turn?.correction) return game
  const turn = { ...game.turn }
  delete turn.correction
  return { ...game, turn }
}

export function recordRoll(game: Game, total: number, gains: Record<string, Record<Resource, number>>): Game {
  game = begin(game)
  if (!Number.isInteger(total) || total < 2 || total > 12) throw new RangeError('Roll must be an integer from 2 to 12')
  const turn = { ...requireTurn(game), rolled: total }
  delete turn.correction
  if (total === 7) turn.robberMoved = false
  else delete turn.robberMoved
  delete turn.gains
  const produced = Object.fromEntries(Object.entries(gains).flatMap(([id, cards]) => {
    const nonzero = Object.fromEntries(RESOURCES.filter((resource) => cards[resource] > 0).map((resource) => [resource, cards[resource]]))
    return Object.keys(nonzero).length ? [[id, nonzero]] : []
  }))
  if (total !== 7 && Object.keys(produced).length) turn.gains = produced
  let next: Game = { ...game, turn }
  for (const [playerId, cards] of Object.entries(gains)) next = gain(next, playerId, cards)
  return next
}

export function recordDiscard(game: Game, playerId: string, cards: Cards | number): Game {
  return typeof cards === 'number' ? loseUnseen(game, playerId, cards) : spend(game, playerId, cards)
}

export function recordRobber(game: Game, hex: AxialCoord, victimId: string | null, stolen: Resource | null): Game {
  let next = withBoard(game, setRobber(game.board, hex))
  if (next.turn?.robberMoved === false) next = { ...next, turn: { ...next.turn, robberMoved: true } }
  if (victimId === null) return next
  const { playerId } = requireTurn(game)
  if (handTotal(ensureStats(game, victimId)) === 0) return next
  if (stolen === null) {
    // The thief's card is one of the types the victim could have held.
    const types = possibleTypes(ensureStats(game, victimId))
    next = loseUnseen(next, victimId, 1)
    const thief = ensureStats(next, playerId)
    return withStats(next, playerId, withUnseenCards(thief, thief.hand, [...unseenCards(thief), types]))
  }
  next = spend(next, victimId, { [stolen]: 1 })
  return gain(next, playerId, { [stolen]: 1 })
}

export function bankRate(board: Board, playerId: string, resource: Resource): number {
  return bankPorts(board, playerId).reduce((rate, port) => port.resource === null || port.resource === resource
    ? Math.min(rate, port.rate) : rate, 4)
}

export function bankPorts(board: Board, playerId: string) {
  const owned = new Set(board.buildings.filter((building) => building.playerId === playerId).map((building) => building.vertexId))
  return board.ports.filter((port) => edgeEndpointVertexIds(port.edgeId).some((vertex) => owned.has(vertex)))
}

export function isValidBankTrade(board: Board, playerId: string, gives: Cards, gets: Cards): boolean {
  let lots = 0
  let received = 0
  for (const resource of RESOURCES) {
    const give = gives[resource] ?? 0
    const get = gets[resource] ?? 0
    const rate = bankRate(board, playerId, resource)
    if (!Number.isInteger(give) || !Number.isInteger(get) || give < 0 || get < 0 || give > 0 && get > 0 || give % rate !== 0) return false
    lots += give / rate
    received += get
  }
  return lots > 0 && lots === received
}

export function recordBankTrade(game: Game, gives: Cards, gets: Cards): Game {
  const { playerId } = requireTurn(game)
  return gain(spend(game, playerId, gives), playerId, gets)
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
  game = begin(game)
  const turn = requireTurn(game)
  const { playerId } = turn
  let next = spend(game, playerId, CARD_COSTS.devCard)
  next = { ...next, turn: { ...turn, devBought: (turn.devBought ?? 0) + 1 } }
  if (drawn === 'vp') return adjustCounter(next, playerId, 'vpCards', 1)
  next = adjustCounter(next, playerId, 'devCards', 1)
  if (playerId === game.board.mePlayerId && drawn !== null) {
    const devHand = devHandFor(game, playerId)
    next = { ...next, devHand: { ...devHand, bought: { ...devHand.bought, [drawn]: devHand.bought[drawn] + 1 } } }
  }
  return next
}

export function recordPlayDev(game: Game, play: DevPlay): Game {
  game = begin(game)
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
      // Monopoly takes every card of the named type, so no other player's unseen card can be one.
      for (const { id } of next.board.players) {
        const stats = ensureStats(next, id)
        if (id !== playerId && stats.handUnknown > 0) {
          next = withStats(next, id, withUnseenCards(stats, stats.hand, unseenCards(stats).map((card) => card.filter((type) => type !== play.resource))))
        }
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
  return { ...next, turn: { ...requireTurn(next), devPlayed: true, progressPlayed } }
}

export function adjustDevHand(game: Game, list: 'playable' | 'bought', kind: DevKind, delta: number): Game {
  const playerId = game.board.mePlayerId
  if (playerId === null) throw new RangeError('No claimed player')
  const stats = ensureStats(game, playerId)
  const current = devHandFor(game, playerId)
  const devHand = { ...current, [list]: { ...current[list], [kind]: Math.max(0, current[list][kind] + delta) } }
  // Move the public count by the typed change only, so cards of unknown type stay counted.
  const devCards = stats.devCards + devHandTotal(devHand) - devHandTotal(current)
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

/** The types a player's hand could hold: known ones and any an unseen card could be. */
export function possibleTypes(stats: PlayerStats): Resource[] {
  const cards = unseenCards(stats)
  return RESOURCES.filter((resource) => stats.hand[resource] > 0 || cards.some((card) => card.includes(resource)))
}

/**
 * Loses `count` cards without seeing them. Each lost card is one of the types the hand could
 * hold, so every known type falls by one, and those cards rejoin the unseen ones, now any of
 * those types, one fewer than before. A hand of wood and brick that loses a card keeps one
 * card that is wood or brick.
 */
function loseUnseen(game: Game, playerId: string, count: number): Game {
  let stats = ensureStats(game, playerId)
  for (let lost = 0; lost < count && handTotal(stats) > 0; lost += 1) {
    const types = possibleTypes(stats)
    const hand = { ...stats.hand }
    let pool = stats.handUnknown - 1
    for (const resource of types) {
      if (hand[resource] === 0) continue
      hand[resource] -= 1
      pool += 1
    }
    stats = withUnseenCards(stats, hand, Array.from({ length: pool }, () => types))
  }
  return withStats(game, playerId, stats)
}

function promoteBought(game: Game): Game {
  const hand = game.devHand
  if (!hand || hand.playerId !== activePlayerId(game) || !DEV_KINDS.some((kind) => hand.bought[kind] > 0)) return game
  const playable = { ...hand.playable }
  for (const kind of DEV_KINDS) playable[kind] += hand.bought[kind]
  return { ...game, devHand: { ...hand, playable, bought: emptyDevCounts() } }
}

// History starts at the first action that writes the turn. Usually that is picking the first player, but a mid-game import with no turn starts it at a roll, a dev card or a log line.
function begin(game: Game): Game {
  return game.turn || game.history ? game : { ...game, history: { start: positionOf(game), turns: [] } }
}

function requireTurn(game: Game): TurnState {
  const turn = turnState(game)
  if (!turn) throw new RangeError('No active player')
  ensureStats(game, turn.playerId)
  return turn
}

/**
 * Spends `cards`, known ones first. A shortfall reveals an unseen card of that type. When more
 * than one unseen card could be it, the ones left could each be any type the candidates could.
 */
function spend(game: Game, playerId: string, cards: Cards): Game {
  const stats = ensureStats(game, playerId)
  const hand = { ...stats.hand }
  let unseen = unseenCards(stats)
  for (const resource of RESOURCES) {
    const count = cards[resource] ?? 0
    for (let short = count - hand[resource]; short > 0 && unseen.length > 0; short -= 1) {
      const candidates = unseen.filter((card) => card.includes(resource))
      // None fits when the ledger was wrong: drop the widest card, as a plain count would.
      if (candidates.length === 0) unseen = unseen.toSorted((a, b) => a.length - b.length).slice(0, -1)
      else {
        const types = RESOURCES.filter((type) => candidates.some((card) => card.includes(type)))
        unseen = [...unseen.filter((card) => !card.includes(resource)), ...candidates.slice(1).map(() => types)]
      }
    }
    hand[resource] = Math.max(0, hand[resource] - count)
  }
  return withStats(game, playerId, withUnseenCards(stats, hand, unseen))
}

function withStats(game: Game, playerId: string, stats: PlayerStats): Game {
  return { ...game, stats: { ...game.stats, [playerId]: stats } }
}
