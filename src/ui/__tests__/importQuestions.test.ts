import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setHexTile, setRobber, setupGrants } from '../../model/board'
import { hexEdgeIds, hexVertexIds } from '../../model/coords'
import { adjustCounter, mergeScreenshot, newGame, withBoard, type Game, type ScreenshotRead } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import type { Board } from '../../model/types'
import { setAwardHolder } from '../../engine/stats'
import { hasQuestions, importQuestions, settleImport } from '../importQuestions'

const A = hexVertexIds({ q: 0, r: -2 })[0]
const B = hexVertexIds({ q: 0, r: 2 })[3]
const C = hexVertexIds({ q: -2, r: 0 })[1]
const D = hexVertexIds({ q: 2, r: 0 })[4]

const twoPlayers = () => addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })

// A finished two-player draft in snake order: aki A, Bee C, Bee D, aki B.
function drafted(): Board {
  let board = twoPlayers()
  for (const [vertex, id] of [[A, 'aki'], [C, 'b'], [D, 'b'], [B, 'aki']] as const) board = placeBuilding(board, vertex, id, 'settlement')
  return board
}

function read(overrides: Partial<ScreenshotRead> = {}): ScreenshotRead {
  return { roster: true, order: true, picks: true, hands: [], unorderedPicks: [], points: {}, knights: [], ...overrides }
}

const owned = (board: Board, id: string) => board.buildings.filter((building) => building.playerId === id).map((building) => building.vertexId)

// Both players have a five-road run, so Longest road is tied between them.
function roadTie(): Game {
  let board = twoPlayers()
  for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'aki')
  for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'b')
  return newGame(board)
}

function fourPlayerDraft(picks: string[]): Board {
  let board = addPlayer(addPlayer(twoPlayers(), { id: 'c', name: 'Cee', color: '#008800' }),
    { id: 'd', name: 'Dee', color: '#884400' })
  for (const [index, id] of picks.entries()) board = placeBuilding(board, boardGrid(board.layout).vertexIds[index], id, 'settlement')
  return board
}

describe('import questions', () => {
  it('asks nothing when the screenshot showed everything, and settles to the same board', () => {
    const game = newGame(drafted())
    const questions = importQuestions(game, read())
    expect(questions).toEqual({ picks: [], order: null, firstChoices: [], longestRoad: null, largestArmy: null })
    expect(hasQuestions(questions)).toBe(false)
    expect(settleImport(game, read(), {}).board).toEqual(game.board)
  })

  it('asks which settlement came second for each unread player and reorders only that pair', () => {
    const game = newGame(drafted())
    const shot = read({ picks: false, unorderedPicks: ['aki'] })
    const questions = importQuestions(game, shot)
    expect(questions.picks).toEqual([{ playerId: 'aki', settlements: [A, B] }])
    expect(hasQuestions(questions)).toBe(true)

    const swapped = settleImport(game, shot, { second: { aki: A } }).board
    expect(owned(swapped, 'aki')).toEqual([B, A])
    expect(owned(swapped, 'b')).toEqual([C, D])
    expect(settleImport(game, shot, { second: { aki: B } }).board.buildings).toEqual(game.board.buildings)
  })

  it('does not ask settlement order once the draft is over', () => {
    const board = placeBuilding(drafted(), B, 'aki', 'city')
    expect(importQuestions(newGame(board), read({ picks: false, unorderedPicks: ['aki', 'b'] })).picks).toEqual([])
  })

  it('asks who went first when only the seating was read, and re-snakes the draft for the new order', () => {
    const game = newGame(drafted())
    const shot = read({ order: false })
    expect(importQuestions(game, shot).order).toBe('first')
    const settled = settleImport(game, shot, { order: ['b', 'aki'] }).board
    expect(settled.players.map((player) => player.id)).toEqual(['b', 'aki'])
    expect(settled.buildings.map((building) => building.vertexId)).toEqual([C, A, B, D])
  })

  it('asks for the whole order when no roster was read, and never for one player', () => {
    expect(importQuestions(newGame(drafted()), read({ roster: false, order: false })).order).toBe('all')
    expect(importQuestions(newGame(createBoard('standard4')), read({ roster: false, order: false })).order).toBeNull()
  })

  it('settles a road tie from the points without asking', () => {
    const game = roadTie()
    const shot = read({ points: { aki: 2, b: 0 } })
    expect(importQuestions(game, shot).longestRoad).toBeNull()
    expect(settleImport(game, shot, {}).awards?.longestRoad).toBe('aki')
  })

  it('asks a road tie the points cannot settle, and never asks the army when knights and points were unread', () => {
    const game = roadTie()
    const questions = importQuestions(game, read())
    expect(questions.longestRoad).toEqual(['aki', 'b'])
    expect(questions.largestArmy).toBeNull()
    expect(settleImport(game, read(), { longestRoad: 'b' }).awards?.longestRoad).toBe('b')
    expect(settleImport(game, read(), {}).awards?.longestRoad ?? null).toBeNull()
  })

  it('gives Largest army to the player whose points show an unexplained award, with three knights', () => {
    const game = newGame(twoPlayers())
    const shot = read({ points: { aki: 0, b: 2 } })
    expect(importQuestions(game, shot).largestArmy).toBeNull()
    const settled = settleImport(game, shot, {})
    expect(settled.awards?.largestArmy).toBe('b')
    expect(settled.stats.b.knights).toBe(3)
  })

  it('asks both awards when the points allow either split, narrowing each by the other answer', () => {
    const game = roadTie()
    const shot = read({ points: { aki: 2, b: 2 } })
    const questions = importQuestions(game, shot)
    expect(questions.longestRoad).toEqual(['aki', 'b'])
    expect(questions.largestArmy).toEqual(['aki', 'b'])
    expect(importQuestions(game, shot, { longestRoad: 'aki' }).largestArmy).toEqual(['b'])
    const settled = settleImport(game, shot, { longestRoad: 'aki' })
    expect(settled.awards).toEqual({ longestRoad: 'aki', largestArmy: 'b' })
    expect(settled.stats.b.knights).toBe(3)
  })

  it('offers nobody for Largest army when the points allow it', () => {
    const game = roadTie()
    // aki holds exactly one award; Bee's points were not read.
    const shot = read({ points: { aki: 2 } })
    const questions = importQuestions(game, shot)
    expect(questions.longestRoad).toEqual(['aki', 'b'])
    expect(questions.largestArmy).toEqual(['aki', 'b', null])
  })

  it('never asks an award already recorded with a holder', () => {
    const game = setAwardHolder(roadTie(), 'longestRoad', 'aki')
    expect(importQuestions(game, read()).longestRoad).toBeNull()
    expect(settleImport(game, read(), {}).awards?.longestRoad).toBe('aki')
  })

  it('asks among knight candidates when knights were read, and lets the points settle it', () => {
    const tied = adjustCounter(adjustCounter(newGame(twoPlayers()), 'aki', 'knights', 3), 'b', 'knights', 3)
    expect(importQuestions(tied, read({ knights: ['aki', 'b'] })).largestArmy).toEqual(['aki', 'b'])
    const shot = read({ knights: ['aki', 'b'], points: { aki: 2, b: 0 } })
    expect(importQuestions(tied, shot).largestArmy).toBeNull()
    expect(settleImport(tied, shot, {}).awards?.largestArmy).toBe('aki')
  })

  it('asks no award when the points contradict every holder', () => {
    const game = newGame(twoPlayers())
    const shot = read({ knights: ['aki', 'b'], points: { aki: 2, b: 2 } })
    const questions = importQuestions(game, shot)
    expect(questions.longestRoad).toBeNull()
    expect(questions.largestArmy).toBeNull()
    expect(settleImport(game, shot, {}).awards?.largestArmy ?? null).toBeNull()
  })

  it.each([4, 2])('raises an unread army holder to the highest read knight count with c at %i', (knights) => {
    const board = addPlayer(twoPlayers(), { id: 'c', name: 'Cee', color: '#008800' })
    const game = adjustCounter(adjustCounter(newGame(board), 'aki', 'knights', 4), 'c', 'knights', knights)
    const shot = read({ knights: ['aki', 'c'], points: { aki: 0, b: 2, c: 0 } })
    const settled = settleImport(game, shot, {})
    expect(settled.stats.b.knights).toBe(4)
    expect(settled.awards?.largestArmy).toBe('b')
    expect(hasQuestions(importQuestions(settled, shot))).toBe(false)
  })

  it('keeps unread players and nobody as army choices beside a unique read leader', () => {
    const game = adjustCounter(roadTie(), 'aki', 'knights', 4)
    const shot = read({ knights: ['aki'], points: { b: 2 } })
    expect(importQuestions(game, shot).largestArmy).toEqual(['aki', 'b', null])
    const settled = settleImport(game, shot, { longestRoad: 'b', largestArmy: null })
    expect(settled.awards).toEqual({ longestRoad: 'b', largestArmy: null })
    expect(settled.stats).toEqual(game.stats)
  })

  it.each([
    [4, ['aki', 'b', 'c', null]],
    [2, ['b', null]],
  ] as const)('limits partly read army candidates when the highest read count is %i', (knights, candidates) => {
    const tied = roadTie()
    let game = withBoard(tied, { ...fourPlayerDraft([]), roads: tied.board.roads })
    game = adjustCounter(adjustCounter(adjustCounter(game, 'aki', 'knights', knights), 'c', 'knights', knights), 'd', 'knights', 1)
    const shot = read({ knights: ['aki', 'c', 'd'], points: { b: 2 } })
    expect(importQuestions(game, shot).largestArmy).toEqual(candidates)
  })

  it('infers the only first player compatible with a partly completed snake', () => {
    const board = fourPlayerDraft(['aki', 'b', 'c', 'd', 'd'])
    const game = newGame({ ...board, players: [...board.players.slice(1), board.players[0]] })
    const shot = read({ order: false })
    const questions = importQuestions(game, shot)
    expect(questions.order).toBeNull()
    expect(questions.firstChoices).toEqual([])
    const settled = settleImport(game, shot, {})
    expect(settled.board.players.map((player) => player.id)).toEqual(['aki', 'b', 'c', 'd'])
    expect(settled.board.buildings.map((building) => building.playerId)).toEqual(['aki', 'b', 'c', 'd', 'd'])
    expect(hasQuestions(importQuestions(settled, shot))).toBe(false)
  })

  it('ignores a first-player answer ruled out by the placed buildings', () => {
    const game = newGame(fourPlayerDraft(['aki', 'b', 'c', 'd', 'd']))
    expect(settleImport(game, read({ order: false }), { order: ['b', 'c', 'd', 'aki'] }).board).toEqual(game.board)
  })

  it.each([
    { picks: [] },
    { picks: ['aki', 'b', 'c', 'd'] },
    { picks: ['aki', 'b', 'c', 'd', 'd', 'c', 'b', 'aki'] },
  ])('offers every seat when all building counts are equal: $picks', ({ picks }) => {
    const game = newGame(fourPlayerDraft(picks))
    const questions = importQuestions(game, read({ order: false }))
    expect(questions.order).toBe('first')
    expect(questions.firstChoices).toEqual(['aki', 'b', 'c', 'd'])
  })

  it('offers every seat but keeps the pieces for building counts that cannot form a snake', () => {
    const game = newGame(fourPlayerDraft(['aki', 'aki', 'c']))
    const shot = read({ order: false })
    expect(importQuestions(game, shot).firstChoices).toEqual(['aki', 'b', 'c', 'd'])
    const settled = settleImport(game, shot, { order: ['b', 'c', 'd', 'aki'] }).board
    expect(settled.players.map((player) => player.id)).toEqual(['b', 'c', 'd', 'aki'])
    expect(settled.buildings).toEqual(game.board.buildings)
  })

  it('has no first-player choices when the whole order or no order is needed', () => {
    const game = newGame(drafted())
    expect(importQuestions(game, read({ roster: false, order: false })).firstChoices).toEqual([])
    expect(importQuestions(game, read()).firstChoices).toEqual([])
  })

  it('re-deals an unchanged setup grant when the second settlement is corrected', () => {
    const board = setHexTile(setHexTile(drafted(), { q: 0, r: -2 }, 'wood'), { q: 0, r: 2 }, 'ore')
    const game = withBoard(newGame({ ...board, buildings: board.buildings.slice(0, -1) }), board)
    expect(game.stats.aki.hand).toEqual(setupGrants(board)?.aki)
    const settled = settleImport(game, read({ picks: false, unorderedPicks: ['aki'] }), { second: { aki: A } })
    expect(settled.stats.aki.hand).toEqual(setupGrants(settled.board)?.aki)
    expect(settled.stats.aki.hand).not.toEqual(game.stats.aki.hand)
    expect(settled.stats.b.hand).toEqual(game.stats.b.hand)
  })

  it('subtracts known VP cards before inferring awards from points', () => {
    const game = adjustCounter(newGame(drafted()), 'aki', 'vpCards', 2)
    const shot = read({ points: { aki: 4, b: 2 } })
    const settled = settleImport(game, shot, {})
    expect(settled.awards?.largestArmy ?? null).toBeNull()
    expect(settled.awards?.longestRoad ?? null).toBeNull()
    expect(settled.stats).toEqual(game.stats)
    expect(hasQuestions(importQuestions(settled, shot))).toBe(false)
  })
})

describe('special build question', () => {
  const seated = (count: number) => {
    let board = createBoard('extension6')
    for (const [index, color] of ['#3063ba', '#008800', '#884400', '#aa00aa', '#00aaaa'].entries()) {
      if (board.players.length < count) board = addPlayer(board, { id: `s${index}`, name: `S${index}`, color })
    }
    return newGame(board)
  }
  const rule = { timing: 'across', who: 'overSeven' } as const

  it('is asked at five and six seats before the game starts, and never blocks on its own', () => {
    expect(importQuestions(seated(4), read()).specialBuild).toBeUndefined()
    expect(importQuestions(seated(5), read()).specialBuild).toBe(true)
    expect(hasQuestions(importQuestions(seated(6), read()))).toBe(true)
    expect(importQuestions({ ...seated(5), specialBuild: rule }, read()).specialBuild).toBeUndefined()
    expect(importQuestions({ ...seated(5), turn: { playerId: 'aki', rolled: null, devPlayed: false,
      progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } } }, read()).specialBuild).toBeUndefined()
  })

  it('stores the answered rule, and leaves it off when unanswered or answered off', () => {
    expect(settleImport(seated(5), read(), { specialBuild: rule }).specialBuild).toEqual(rule)
    expect(settleImport(seated(5), read(), {}).specialBuild).toBeUndefined()
    expect(settleImport(seated(5), read(), { specialBuild: null }).specialBuild).toBeUndefined()
    expect(settleImport(seated(4), read(), { specialBuild: rule }).specialBuild).toBeUndefined()
  })
})

describe('first-round import', () => {
  const hex = (q: number, r: number) => ({ q, r })
  const NONE = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
  const ORE = { ...NONE, ore: 3 }
  const IDS = ['aki', 'b', 'c', 'd']

  // A four-player draft on an all-ore board, except Aki's second settlement touches wood, brick and sheep.
  function fourPlayerBoard(): Board {
    let board = addPlayer(addPlayer(twoPlayers(), { id: 'c', name: 'Cee', color: '#008800' }), { id: 'd', name: 'Dee', color: '#884400' })
    for (const { coord } of board.hexes) board = setHexTile(board, coord, 'ore')
    for (const [coord, tile] of [[hex(0, 0), 'wood'], [hex(0, 1), 'brick'], [hex(1, 0), 'sheep'], [hex(1, 1), 'desert']] as const) {
      board = setHexTile(board, coord, tile)
    }
    const firsts = [hexVertexIds(hex(0, 2))[0], hexVertexIds(hex(2, 0))[0], hexVertexIds(hex(-2, 0))[2], hexVertexIds(hex(0, -2))[4]]
    const seconds = [hexVertexIds(hex(0, 0))[0], hexVertexIds(hex(0, -2))[1], hexVertexIds(hex(2, -2))[1], hexVertexIds(hex(-2, 2))[4]]
    for (const [index, id] of [...IDS, ...[...IDS].reverse()].entries()) {
      board = placeBuilding(board, (index < 4 ? firsts : seconds)[index < 4 ? index : 7 - index], id, 'settlement')
    }
    // The two starting roads each, on hexes far from the settlements that matter.
    for (const [index, id] of IDS.entries()) {
      for (const edge of hexEdgeIds(hex(index - 2, 2 - index)).slice(0, 2)) board = placeRoad(board, edge, id)
    }
    return setRobber(board, hex(1, 1))
  }

  // What a screenshot merge leaves: every hand only as a count.
  function counted(board: Board, totals: number[]): Game {
    let game = newGame(board)
    for (const [index, id] of IDS.entries()) game = adjustCounter(game, id, 'handUnknown', totals[index])
    return game
  }
  const hands = (game: Game) => Object.fromEntries(IDS.map((id) => [id, { ...game.stats[id].hand, unknown: game.stats[id].handUnknown }]))
  const shot = read({ hands: IDS })

  it('asks once the draft is finished and a hand has cards of unknown type, and not otherwise', () => {
    const board = fourPlayerBoard()
    expect(importQuestions(counted(board, [3, 3, 3, 3]), shot).firstRound).toBe(true)
    expect(importQuestions(counted(board, [3, 3, 3, 3]), read()).firstRound).toBeUndefined()
    const dealt = withBoard(newGame({ ...board, buildings: [] }), board)
    expect(dealt.stats.d.hand).toEqual(ORE)
    expect(importQuestions(dealt, shot).firstRound).toBeUndefined()
    const unfinished = { ...board, buildings: board.buildings.slice(0, 7) }
    expect(importQuestions(counted(unfinished, [3, 3, 3, 3]), shot).firstRound).toBeUndefined()
  })

  it('gives the players still to move their starting hands, and works out the rest from roads and counts', () => {
    // Cee's turn: Aki built a road and rolled, Bee rolled nothing for anyone, Cee just rolled one card in.
    let board = fourPlayerBoard()
    board = placeRoad(board, hexEdgeIds(hex(0, 2))[3], 'aki')
    const game = counted(board, [3, 3, 4, 3])
    expect(hands(settleImport(game, shot, { firstRound: true }))).toEqual({
      aki: { ...NONE, sheep: 1, unknown: 2 },
      b: { ...ORE, unknown: 0 },
      c: { ...ORE, unknown: 1 },
      d: { ...ORE, unknown: 0 },
    })
    expect(hands(settleImport(game, shot, { firstRound: false }))).toEqual(hands(game))
  })

  it('keeps unknown the card the robber could have taken', () => {
    // Bee rolled a 7 and robbed Dee, whose second settlement is the only piece on the robber's hex.
    const board = setRobber(fourPlayerBoard(), hex(-2, 2))
    const settled = settleImport(counted(board, [3, 4, 3, 2]), shot, { firstRound: true })
    expect(hands(settled)).toEqual({
      aki: { ...NONE, wood: 1, brick: 1, sheep: 1, unknown: 0 },
      b: { ...ORE, unknown: 1 },
      c: { ...ORE, unknown: 0 },
      d: { ...NONE, ore: 2, unknown: 0 },
    })
    // A full count next to the robber may still hide a stolen card replaced by production.
    expect(hands(settleImport(counted(board, [3, 4, 3, 3]), shot, { firstRound: true })).d).toEqual({ ...NONE, ore: 2, unknown: 1 })
  })

  it('drops a narrowing of the old unseen cards when it rebuilds a hand', () => {
    const game = counted(fourPlayerBoard(), [3, 3, 3, 3])
    const narrowed = { ...game, stats: { ...game.stats, b: { ...game.stats.b, handUnknownAmong: [['wood', 'ore'], ['wood', 'ore'], ['wood', 'ore']] } } } as Game
    const settled = settleImport(narrowed, shot, { firstRound: true })
    expect(settled.stats.b.handUnknownAmong).toBeUndefined()
    expect(hands(settled).b).toEqual(hands(settleImport(game, shot, { firstRound: true })).b)
  })

  it('names the starting cards a draft finished by screenshot never dealt', () => {
    const board = fourPlayerBoard()
    const saved = newGame({ ...board, buildings: board.buildings.slice(0, 7) })
    const merged = mergeScreenshot(saved, counted(board, [3, 3, 3, 3]), shot)
    expect(merged.stats.aki.hand).toEqual(NONE)
    expect(hands(settleImport(merged, shot, { firstRound: true })).aki).toEqual({ ...NONE, wood: 1, brick: 1, sheep: 1, unknown: 0 })
  })
})
