import { awardCandidates, initializeAwards, LARGEST_ARMY_MIN, setAwardHolder } from '../engine/stats'
import { AWARD_VP, buildingPoints, setupGrants, snakeOrder } from '../model/board'
import { axialKey, parseVertexId } from '../model/coords'
import { adjustCounter, withBoard, type AwardKind, type Game, type ScreenshotRead } from '../model/game'
import { CARD_COSTS } from '../model/turn'
import { RESOURCES, type Board, type Resource, type VertexId } from '../model/types'

export interface ImportQuestions {
  picks: { playerId: string; settlements: [VertexId, VertexId] }[]
  order: 'first' | 'all' | null
  firstChoices: string[]
  longestRoad: (string | null)[] | null
  largestArmy: (string | null)[] | null
  /** Set when the draft is finished and a read hand has cards of unknown type, which the starting hands can name. */
  firstRound?: true
}

export interface ImportAnswers {
  second?: Record<string, VertexId>
  order?: string[]
  longestRoad?: string | null
  largestArmy?: string | null
  firstRound?: boolean
}

export const AWARDS = ['longestRoad', 'largestArmy'] as const
export const otherAward = (kind: AwardKind): AwardKind => kind === 'longestRoad' ? 'largestArmy' : 'longestRoad'

/** Player ids in seat order, starting from seat `start`. */
export function turnOrderFrom(board: Board, start: number): string[] {
  const ids = board.players.map((player) => player.id)
  return [...ids.slice(start), ...ids.slice(0, start)]
}

const draftShape = (board: Board) => board.buildings.every((building) => building.tier === 'settlement') &&
  board.players.every((player) => board.buildings.filter((building) => building.playerId === player.id).length <= 2)

/** The first players whose snake gives every player the settlements they hold now. */
function snakeStarts(board: Board): string[] {
  const ids = board.players.map((player) => player.id)
  return ids.filter((_, start) => {
    const order = turnOrderFrom(board, start)
    const picks = snakeOrder(order.map((id) => [id, id])).slice(0, board.buildings.length)
    return ids.every((id) => picks.filter((pick) => pick === id).length ===
      board.buildings.filter((building) => building.playerId === id).length)
  })
}

function possibleFirstPlayers(board: Board, read: ScreenshotRead): string[] {
  if (!read.roster || read.order || board.players.length < 2) return []
  const ids = board.players.map((player) => player.id)
  // A board no snake explains (pieces placed by hand) leaves every seat open, and keeps its pieces as placed.
  const fitting = draftShape(board) ? snakeStarts(board) : ids
  return fitting.length > 0 ? fitting : ids
}

function initializeImportAwards(game: Game, read: ScreenshotRead): Game {
  const initialized = initializeAwards(game)
  if (game.awards?.largestArmy != null || initialized.awards?.largestArmy == null ||
    game.board.players.every((player) => read.knights.includes(player.id))) return initialized

  // Unread knights can still tie or beat a unique read leader.
  return { ...initialized, awards: { ...initialized.awards, largestArmy: null } }
}

function awardOptions(game: Game, read: ScreenshotRead, answers: ImportAnswers) {
  const ids = game.board.players.map((player) => player.id)
  const knightsRead = ids.every((id) => read.knights.includes(id))
  const candidates = (kind: AwardKind): (string | null)[] => {
    const holder = game.awards?.[kind]
    if (holder != null) return [holder]
    if (kind === 'largestArmy' && !knightsRead) {
      const highest = Math.max(LARGEST_ARMY_MIN, ...ids.filter((id) => read.knights.includes(id)).map((id) => game.stats[id].knights))
      return [...ids.filter((id) => !read.knights.includes(id) || game.stats[id].knights === highest), null]
    }
    const eligible = awardCandidates(game, kind)
    return eligible.length > 0 ? eligible : [null]
  }
  const roads = candidates('longestRoad')
  const armies = candidates('largestArmy')
  const pairs = (army: (string | null)[]) => roads.flatMap((longestRoad) => army.map((largestArmy) => ({ longestRoad, largestArmy })))
  const surplus = ids.flatMap((id) => {
    const points = read.points[id] - game.board.buildings.filter((building) => building.playerId === id)
      .reduce((sum, building) => sum + buildingPoints(building.tier), 0) - game.stats[id].vpCards
    return [0, AWARD_VP, 2 * AWARD_VP].includes(points) ? [{ id, awards: points / AWARD_VP }] : []
  })
  let possible = pairs(armies).filter((pair) => surplus.every(({ id, awards }) =>
    Number(pair.longestRoad === id) + Number(pair.largestArmy === id) === awards))
  if (surplus.length === 0 || possible.length === 0) {
    possible = pairs(knightsRead || game.awards?.largestArmy != null ? armies : [null])
  }
  return AWARDS.map((kind) => {
    const other = otherAward(kind)
    const answer = answers[other]
    const narrowed = answer !== undefined && possible.some((pair) => pair[other] === answer)
      ? possible.filter((pair) => pair[other] === answer) : possible
    return {
      kind,
      ask: game.awards?.[kind] == null && new Set(possible.map((pair) => pair[kind])).size > 1,
      options: [...ids, null].filter((id) => narrowed.some((pair) => pair[kind] === id)),
    }
  })
}

export function importQuestions(game: Game, read: ScreenshotRead, answers: ImportAnswers = {}): ImportQuestions {
  game = initializeImportAwards(game, read)
  const { board } = game
  const choices = possibleFirstPlayers(board, read)
  const questions: ImportQuestions = {
    picks: [],
    order: board.players.length < 2 || choices.length === 1 ? null : !read.roster ? 'all' : !read.order ? 'first' : null,
    firstChoices: choices.length === 1 ? [] : choices,
    longestRoad: null,
    largestArmy: null,
  }
  if (draftShape(board)) {
    for (const player of board.players) {
      if (!read.unorderedPicks.includes(player.id)) continue
      const placed = board.buildings.filter((building) => building.playerId === player.id)
      if (placed.length === 2) questions.picks.push({ playerId: player.id, settlements: [placed[0].vertexId, placed[1].vertexId] })
    }
  }
  for (const { kind, ask, options } of awardOptions(game, read, answers)) {
    if (ask) questions[kind] = options
  }
  if (setupGrants(board) !== null && read.hands.some((id) => game.stats[id].handUnknown > 0)) questions.firstRound = true
  return questions
}

export function hasQuestions(questions: ImportQuestions): boolean {
  return questions.picks.length > 0 || questions.order !== null || questions.longestRoad !== null || questions.largestArmy !== null ||
    questions.firstRound === true
}

const ROAD_COST: Partial<Record<Resource, number>> = CARD_COSTS.road
const DEV_CARD_COST: Partial<Record<Resource, number>> = CARD_COSTS.devCard

/**
 * Each read hand rebuilt from its starting cards, for a screenshot from the first
 * round. A player keeps their starting cards less what their roads beyond the
 * draft's two and their dev cards cost, and whatever more the screenshot counts
 * stays unknown (production). Assumes no trades, and no 7 unless the robber has
 * left the desert, when one card of anyone touching its hex may have been stolen.
 * A hand smaller than its base, or one that may have been robbed, keeps only the
 * cards that loss could not have taken.
 */
function firstRoundHands(game: Game, read: ScreenshotRead): Game {
  const { board } = game
  const grants = setupGrants(board)
  if (grants === null) return game
  const robberKey = board.robber && axialKey(board.robber)
  const robberHex = board.hexes.find((hex) => axialKey(hex.coord) === robberKey)
  const stealable = robberHex !== undefined && robberHex.tile !== 'desert'
  const stats = { ...game.stats }
  for (const { id } of board.players) {
    if (!read.hands.includes(id)) continue
    const current = stats[id]
    const total = current.handUnknown + RESOURCES.reduce((sum, resource) => sum + current.hand[resource], 0)
    const roads = Math.max(0, board.roads.filter((road) => road.playerId === id).length - 2)
    const base = Object.fromEntries(RESOURCES.map((resource) => [resource, Math.max(0,
      grants[id][resource] - roads * (ROAD_COST[resource] ?? 0) - current.devCards * (DEV_CARD_COST[resource] ?? 0))]))
    const robbable = stealable && board.buildings.some((building) =>
      building.playerId === id && parseVertexId(building.vertexId).some((coord) => axialKey(coord) === robberKey))
    const lost = Math.max(RESOURCES.reduce((sum, resource) => sum + base[resource], 0) - total, robbable ? 1 : 0)
    const hand = { ...current.hand }
    for (const resource of RESOURCES) hand[resource] = Math.max(0, base[resource] - lost)
    stats[id] = { ...current, hand, handUnknown: total - RESOURCES.reduce((sum, resource) => sum + hand[resource], 0) }
  }
  return { ...game, stats }
}

/** The questions the Finish import card asks for this game, or null when the card is not shown. */
export function openImportQuestions(game: Game): ImportQuestions | null {
  if (!game.pendingImport) return null
  const questions = importQuestions(game, game.pendingImport)
  return hasQuestions(questions) ? questions : null
}

export function settleImport(game: Game, read: ScreenshotRead, answers: ImportAnswers): Game {
  game = initializeImportAwards(game, read)
  let { board } = game
  const questions = importQuestions(game, read)
  const choices = possibleFirstPlayers(board, read)
  const inferred = choices.length === 1
  const start = board.players.findIndex((player) => player.id === choices[0])
  const order = inferred ? turnOrderFrom(board, start) : answers.order
  if ((questions.order || inferred) && order && order.length === board.players.length && new Set(order).size === order.length &&
    (questions.order !== 'first' || questions.firstChoices.includes(order[0])) &&
    order.every((id) => board.players.some((player) => player.id === id))) {
    const players = order.map((id) => board.players.find((player) => player.id === id)!)
    const buildings = draftShape(board) && snakeStarts(board).includes(order[0])
      ? snakeOrder(players.map((player) => board.buildings.filter((building) => building.playerId === player.id))) : board.buildings
    board = { ...board, players, buildings }
  }
  for (const { playerId, settlements } of questions.picks) {
    if (answers.second?.[playerId] !== settlements[0]) continue
    const buildings = [...board.buildings]
    const first = buildings.findIndex((building) => building.vertexId === settlements[0])
    const second = buildings.findIndex((building) => building.vertexId === settlements[1])
    ;[buildings[first], buildings[second]] = [buildings[second], buildings[first]]
    board = { ...board, buildings }
  }
  if (board !== game.board) game = withBoard(game, board)
  // After the board settles: an answered second settlement decides the starting hands.
  if (questions.firstRound && answers.firstRound) game = firstRoundHands(game, read)
  for (const { kind, options } of awardOptions(game, read, answers)) {
    if (game.awards?.[kind] != null) continue
    const answer = answers[kind]
    const holder = answer !== undefined && options.includes(answer) ? answer : options.length === 1 ? options[0] : undefined
    if (holder === undefined) continue
    if (kind === 'largestArmy' && holder !== null && !read.knights.includes(holder)) {
      const highest = Math.max(LARGEST_ARMY_MIN, ...game.board.players.map((player) => game.stats[player.id].knights))
      game = adjustCounter(game, holder, 'knights', highest - game.stats[holder].knights)
    }
    const settled = setAwardHolder(game, kind, holder)

    // Choosing one award cannot settle the other's unread counts.
    if (settled.awards) game = { ...settled, awards: {
      longestRoad: null, largestArmy: null, ...game.awards, [kind]: settled.awards[kind],
    } }
  }
  return game
}
