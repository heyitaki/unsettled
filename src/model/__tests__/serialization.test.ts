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
