import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setRobber } from '../board'
import { adjustHand, newGame, withBoard, type Game } from '../game'
import { historyGame, turnSummary } from '../history'
import { vertexIncidentEdgeIds } from '../coords'
import { boardGrid } from '../layouts'
import { serializeGame, parseGame } from '../serialization'
import { appendLog, endTurn, recordBuild, recordRoll, setActivePlayer } from '../turn'
import type { VertexId } from '../types'

const grid = boardGrid('standard4')
const [v1, , , , , , v2] = grid.vertexIds
const roadAt = (vertex: VertexId) => vertexIncidentEdgeIds(vertex)[0]

function started(): Game {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: '#e58331' })
  board = placeBuilding(board, v1, 'b', 'settlement')
  const game = adjustHand(adjustHand(newGame(board), 'b', 'wood', 3), 'b', 'brick', 3)
  return setActivePlayer(game, 'b')
}

const sorted = (game: Game) => ({
  buildings: [...game.board.buildings].sort((a, b) => a.vertexId.localeCompare(b.vertexId)),
  roads: [...game.board.roads].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
  robber: game.board.robber,
  stats: game.stats,
})

describe('turn log', () => {
  it('appends recorded actions to the current turn', () => {
    const game = appendLog(appendLog(started(), 'Built a road'), 'Bought a dev card')
    expect(game.turn?.log).toEqual(['Built a road', 'Bought a dev card'])
  })

  it('keeps what a roll produced, nonzero cards only, and nothing on a 7', () => {
    const game = recordRoll(started(), 8, {
      b: { wood: 1, brick: 0, sheep: 0, wheat: 2, ore: 0 },
      c: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    })
    expect(game.turn?.gains).toEqual({ b: { wood: 1, wheat: 2 } })
    expect(recordRoll(started(), 7, {}).turn?.gains).toBeUndefined()
  })
})

describe('game history', () => {
  it('starts when the first turn begins', () => {
    const before = adjustHand(newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })), 'b', 'ore', 2)
    const game = setActivePlayer(before, 'b')
    expect(game.history?.turns).toEqual([])
    expect(sorted(historyGame(game, 0))).toEqual(sorted(before))
  })

  it('starts at the first roll when no turn was started', () => {
    const before = adjustHand(newGame(placeBuilding(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }), v1, 'b', 'settlement')), 'b', 'wood', 1)
    const mid = { ...before, board: { ...before.board, mePlayerId: 'b' } }
    const game = endTurn(recordBuild(recordRoll(mid, 6, {}), 'road', roadAt(v1), { free: true }))
    expect(sorted(historyGame(game, 0))).toEqual(sorted(mid))
    expect(game.history?.turns[0].roads).toBeDefined()
  })

  it('records each finished turn and starts the next one clean', () => {
    let game = recordRoll(started(), 6, { b: { wood: 0, brick: 0, sheep: 1, wheat: 0, ore: 0 } })
    game = appendLog(recordBuild(game, 'road', roadAt(v1)), 'Built a road')
    const ended = endTurn(game)
    expect(ended.history?.turns).toHaveLength(1)
    expect(ended.history?.turns[0]).toMatchObject({ playerId: 'b', rolled: 6, gains: { b: { sheep: 1 } }, log: ['Built a road'] })
    expect(ended.turn?.log).toBeUndefined()
    expect(ended.turn?.gains).toBeUndefined()
    expect(sorted(historyGame(ended, 1))).toEqual(sorted(game))
  })

  it('folds every turn back to the position it ended in, removals included', () => {
    let game = started()
    const snapshots: Game[] = []
    game = appendLog(recordBuild(recordRoll(game, 5, {}), 'road', roadAt(v1)), 'Built a road')
    snapshots.push(game)
    game = endTurn(game)
    // A board correction mid-game: a piece removed and the robber moved, outside any recorded action.
    game = withBoard(recordRoll(game, 9, {}), setRobber(placeRoad({ ...game.board, buildings: [] }, roadAt(v2), 'c'), game.board.hexes[3].coord))
    snapshots.push(game)
    game = endTurn(game)
    game = recordRoll(game, 4, {})
    snapshots.push(game)
    game = endTurn(game)
    expect(game.history?.turns).toHaveLength(3)
    snapshots.forEach((snapshot, index) => expect(sorted(historyGame(game, index + 1))).toEqual(sorted(snapshot)))
    expect(historyGame(game, 2).board.buildings).toEqual([])
  })

  it('keeps terrain from the live board and the turn player of the shown turn', () => {
    const game = endTurn(endTurn(recordRoll(started(), 3, {})))
    const past = historyGame(game, 1)
    expect(past.board.hexes).toBe(game.board.hexes)
    expect(past.board.ports).toBe(game.board.ports)
    expect(past.turn?.playerId).toBe('b')
  })

  it('stores pieces as changes, not a full copy per turn', () => {
    let game = started()
    for (let turn = 0; turn < 6; turn += 1) game = endTurn(recordRoll(game, 8, {}))
    expect(game.history?.turns.every((record) => !record.buildings && !record.roads && !record.stats)).toBe(true)
  })

  it('stores only the players whose stats changed, and a removed player as null', () => {
    let game = recordRoll(started(), 8, { c: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    game = endTurn(game)
    expect(Object.keys(game.history?.turns[0].stats ?? {})).toEqual(['c'])
    const before = game
    game = endTurn(withBoard(game, { ...game.board, players: game.board.players.filter((player) => player.id !== 'c') }))
    expect(game.history?.turns[1].stats).toMatchObject({ c: null })
    expect(historyGame(game, 1).stats).toEqual(historyGame(before, 1).stats)
    expect(historyGame(game, 2).stats).not.toHaveProperty('c')
    expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
  })

  it('survives a save and reload', () => {
    let game = appendLog(recordRoll(started(), 8, { b: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 } }), 'Built a road')
    game = appendLog(endTurn(game), 'Bought a dev card')
    expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
  })

  it('drops a damaged history without failing the game', () => {
    const game = endTurn(recordRoll(started(), 8, {}))
    const raw = JSON.parse(serializeGame(game))
    raw.history.turns[0].log = 'not a list'
    const result = parseGame(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.game.history).toBeUndefined()
      expect(result.game.turn).toEqual(game.turn)
    }
  })

  it('rejects a damaged turn log like any other turn field', () => {
    const raw = JSON.parse(serializeGame(appendLog(started(), 'Built a road')))
    raw.turn.log = [3]
    expect(parseGame(raw).ok).toBe(false)
  })
})

describe('turnSummary', () => {
  it.each([
    [[], ''],
    [['Built a road', 'Bought a dev card', 'Built a road'], 'Built 2 roads, bought a dev card'],
    [['Robber to Ore 6 · Stole from Green', 'Traded 4 wheat to the bank for 1 wood', 'Built a road'], 'Robbed Green, traded with the bank, built a road'],
    [['Robber to Desert · Nobody robbed'], 'Moved the robber'],
    [['Played Knight · Robber to Wheat 5, stole from Orange'], 'Played Knight, robbed Orange'],
    [['Played Knight · Robber to Wheat 5 · Nobody robbed'], 'Played Knight'],
    [['Played Monopoly on wheat · Took 5', 'Played Year of plenty · Wheat and ore'], 'Played Monopoly, played Year of plenty'],
    [['Played Road building · 2 roads'], 'Played Road building'],
    [['Traded 1 sheep to Blue for 1 ore', 'Traded 2 wheat to the port for 1 brick'], 'Traded with Blue, traded with the port'],
    [['Built a city', 'Built a settlement'], 'Built a city, built a settlement'],
  ])('%j reads %j', (log, summary) => {
    expect(turnSummary(log)).toBe(summary)
  })
})
