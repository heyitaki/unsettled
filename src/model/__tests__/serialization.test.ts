import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  placeBuilding,
  placeRoad,
  setRobber,
  upsertPort,
} from '../board'
import { setTile } from './helpers'
import { adjustCounter, adjustHand, emptyStats, newGame } from '../game'
import { boardGrid } from '../layouts'
import { parseBoard, parseGame, serializeGame } from '../serialization'

describe('board serialization', () => {
  it.each(['standard4', 'extension6'] as const)('round trips a populated %s board', (layout) => {
    let board = addPlayer(createBoard(layout), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    const resources = ['wood', 'sheep', 'wheat', 'brick', 'ore'] as const
    const numbers = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
    for (const [index, hex] of board.hexes.entries()) {
      board = index === board.hexes.length - 1
        ? setTile(board, hex.coord, 'desert')
        : setTile(board, hex.coord, resources[index % resources.length], numbers[index % numbers.length])
    }
    board = upsertPort(board, board.ports[0].edgeId, 'wood', 2)
    board = upsertPort(board, board.ports[1].edgeId, null, 5)
    board = setRobber(board, board.hexes.at(-1)!.coord)
    board = placeRoad(board, boardGrid(layout).edgeIds[0], 'b')
    board = placeRoad(board, boardGrid(layout).edgeIds[1], 'aki')
    board = placeBuilding(board, boardGrid(layout).vertexIds[0], 'aki', 'superCity')
    board = placeBuilding(board, boardGrid(layout).vertexIds[1], 'b', 'city')
    expect(parseBoard(JSON.stringify(board))).toEqual({ ok: true, board })
  })

  it('rejects future schemas, extra keys, malformed JSON, and invalid locations', () => {
    const board = createBoard('standard4')
    expect(parseBoard('{')).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, schemaVersion: 2 })).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, surprise: true })).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, roads: [{ edgeId: 'e:99,99;100,99', playerId: 'aki' }] })).toMatchObject({ ok: false })
  })

  it('rejects unparseable piece ids without throwing', () => {
    const board = createBoard('standard4')
    expect(parseBoard({ ...board, buildings: [{ vertexId: 'v:garbage', playerId: 'aki', tier: 'settlement' }] }))
      .toMatchObject({ ok: false })
    expect(parseBoard({ ...board, roads: [{ edgeId: 'e:garbage', playerId: 'aki' }] })).toMatchObject({ ok: false })
    expect(parseBoard({ ...board, ports: [{ edgeId: 'e:garbage', resource: null, rate: 3 }] }))
      .toMatchObject({ ok: false })
  })

  it('rejects non-canonical piece ids that would evade duplicate detection', () => {
    const board = createBoard('standard4')
    const canonical = boardGrid('standard4').vertexIds[0]
    const shuffled = `v:${canonical.slice(2).split(';').reverse().join(';')}`
    expect(parseBoard({ ...board, buildings: [{ vertexId: shuffled, playerId: 'aki', tier: 'settlement' }] }))
      .toMatchObject({ ok: false })
  })

  it('rejects an empty roster', () => {
    const board = createBoard('standard4')
    const result = parseBoard({ ...board, players: [], mePlayerId: null, roads: [], buildings: [] })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.errors).toContain('Board has no players')
  })
})

describe('game serialization', () => {
  it('round trips a game with live stats', () => {
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    let game = newGame(board)
    game = adjustHand(game, 'aki', 'ore', 3)
    game = adjustCounter(game, 'b', 'knights', 2)
    expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
  })

  it('zero-fills stats entries missing from the roster', () => {
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    const result = parseGame({ schemaVersion: 1, board, stats: {} })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.game.stats.b).toEqual(emptyStats())
  })

  it('rejects malformed stats, unknown stat players, and bad envelopes', () => {
    const game = newGame(createBoard('standard4'))
    expect(parseGame('{')).toMatchObject({ ok: false })
    expect(parseGame({ ...game, schemaVersion: 2 })).toMatchObject({ ok: false })
    expect(parseGame({ ...game, surprise: true })).toMatchObject({ ok: false })
    expect(parseGame({ ...game, stats: { ghost: emptyStats() } })).toMatchObject({ ok: false })
    expect(parseGame({ ...game, stats: { aki: { ...emptyStats(), devCards: -1 } } })).toMatchObject({ ok: false })
    expect(parseGame({ ...game, stats: { aki: { ...emptyStats(), hand: { wood: 1 } } } })).toMatchObject({ ok: false })
    expect(parseGame({ ...game, stats: { aki: { ...emptyStats(), extra: 1 } } })).toMatchObject({ ok: false })
  })

  it('rejects a game whose embedded board is invalid', () => {
    const game = newGame(createBoard('standard4'))
    expect(parseGame({ ...game, board: { ...game.board, schemaVersion: 2 } })).toMatchObject({ ok: false })
  })
})

it('a game saved before turn tracking still loads', () => {
  const board = createBoard('standard4')
  const old = `{"schemaVersion":1,"board":${JSON.stringify(board)},"stats":{}}`
  const awards = `{"schemaVersion":1,"board":${JSON.stringify(board)},"stats":{},"awards":{"longestRoad":null,"largestArmy":"aki"}}`
  expect(parseGame(old)).toEqual({ ok: true, game: newGame(board) })
  expect(parseGame(awards)).toEqual({ ok: true, game: { ...newGame(board), awards: { longestRoad: null, largestArmy: 'aki' } } })
})

it('turn and devHand round-trip through serializeGame and parseGame', () => {
  const game = newGame(createBoard('standard4'))
  const turn = { playerId: 'aki', rolled: 8, devPlayed: true, progressPlayed: { roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 } }
  const devHand = {
    playerId: 'aki',
    playable: { knight: 2, roadBuilding: 1, yearOfPlenty: 0, monopoly: 0 },
    bought: { knight: 1, roadBuilding: 0, yearOfPlenty: 1, monopoly: 0 },
  }
  const awards = { longestRoad: null, largestArmy: 'aki' }
  for (const withTurn of [false, true]) {
    for (const withHand of [false, true]) {
      for (const withAwards of [false, true]) {
        const input = { ...game, ...(withTurn ? { turn } : {}), ...(withHand ? { devHand } : {}), ...(withAwards ? { awards } : {}) }
        expect(parseGame(serializeGame(input))).toEqual({ ok: true, game: input })
        expect(parseGame(input)).toEqual({ ok: true, game: input })
      }
    }
  }
  for (const rolled of [null, 2, 12]) {
    const input = { ...game, turn: { ...turn, rolled } }
    expect(parseGame(input)).toEqual({ ok: true, game: input })
  }
  const input = { ...game, turn, devHand, awards }
  const result = parseGame(input)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.errors.join(', '))
  const before = structuredClone(input)
  expect(result.game.turn).not.toBe(turn)
  expect(result.game.turn?.progressPlayed).not.toBe(turn.progressPlayed)
  expect(result.game.devHand).not.toBe(devHand)
  expect(result.game.devHand?.playable).not.toBe(devHand.playable)
  expect(result.game.devHand?.bought).not.toBe(devHand.bought)
  turn.progressPlayed.monopoly = 10
  devHand.playable.knight = 10
  devHand.bought.monopoly = 10
  expect(result.game).toEqual(before)
})

it('rejects a turn or devHand that names a player outside the roster', () => {
  const game = newGame(createBoard('standard4'))
  const counts = { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  for (const playerId of ['ghost', 'toString', '__proto__']) {
    for (const field of [
      { turn: { playerId, rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } } },
      { devHand: { playerId, playable: counts, bought: counts } },
    ]) {
      const result = parseGame({ ...game, ...field })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors).toHaveLength(1)
    }
  }
})

it('rejects malformed turn and devHand fields', () => {
  const game = newGame(createBoard('standard4'))
  const turn = { playerId: 'aki', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } }
  const counts = { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  const devHand = { playerId: 'aki', playable: counts, bought: counts }
  const fields: unknown[] = [
    ...[undefined, null, [], {}, { ...turn, rolled: 13 }, { ...turn, rolled: 1 }, { ...turn, rolled: 6.5 },
      { ...turn, rolled: '6' }, { ...turn, devPlayed: 1 }, { ...turn, progressPlayed: -1 },
      { ...turn, progressPlayed: 0.5 }, { ...turn, playerId: null }, { ...turn, extra: 1 },
      { playerId: 'aki', rolled: null, devPlayed: false },
    ].map((value) => ({ turn: value })),
    ...[undefined, null, [], {}, { ...devHand, extra: 1 }, { playerId: 'aki', playable: counts },
      { ...devHand, playable: { ...counts, knight: -1 } }, { ...devHand, bought: { ...counts, monopoly: -1 } },
      { ...devHand, playable: { knight: 0, roadBuilding: 0, yearOfPlenty: 0 } },
      { ...devHand, bought: { knight: 0, roadBuilding: 0, yearOfPlenty: 0 } },
      { ...devHand, playable: { ...counts, extra: 0 } }, { ...devHand, bought: { ...counts, extra: 0 } },
      { ...devHand, playable: null }, { ...devHand, bought: [] },
      { ...devHand, playable: { ...counts, knight: 0.5 } }, { ...devHand, bought: { ...counts, knight: '1' } },
    ].map((value) => ({ devHand: value })),
  ]
  for (const field of fields) {
    const result = parseGame(Object.assign({}, game, field))
    expect(result.ok, JSON.stringify(field)).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(1)
  }
})

it('rejects an unknown top-level field', () => {
  const game = newGame(createBoard('standard4'))
  const result = parseGame({ ...game, turn: { playerId: 'aki', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } }, extra: true })
  expect(result).toEqual({ ok: false, errors: ['Game contains missing or unknown top-level fields'] })
  for (const missing of ['schemaVersion', 'board', 'stats'] as const) {
    const input: Record<string, unknown> = { ...game }
    delete input[missing]
    expect(parseGame(input).ok).toBe(false)
  }
})

it('progressPlayed requires exactly the three non-negative integer counts', () => {
  const game = newGame(createBoard('standard4'))
  const counts = { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 }
  const invalid: unknown[] = [0, 2, null, [], { ...counts, knight: 0 }]
  for (const kind of ['roadBuilding', 'yearOfPlenty', 'monopoly'] as const) {
    const missing: Partial<typeof counts> = { ...counts }
    delete missing[kind]
    invalid.push(missing)
    for (const value of [-1, 0.5, '1', null]) invalid.push({ ...counts, [kind]: value })
  }
  for (const progressPlayed of invalid) {
    expect(parseGame({ ...game, turn: { playerId: 'aki', rolled: null, devPlayed: false, progressPlayed } }).ok, JSON.stringify(progressPlayed)).toBe(false)
  }
})
