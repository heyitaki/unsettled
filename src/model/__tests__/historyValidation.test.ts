import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, removePlayer } from '../board'
import { adjustDevHand, appendLog, endTurn, recordRoll, setActivePlayer } from '../turn'
import { newGame, withBoard } from '../game'
import { historyGame, positionOf } from '../history'
import { boardGrid } from '../layouts'
import { parseGame, serializeGame } from '../serialization'
import type { Game } from '../game'

function recorded() {
  const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  return endTurn(appendLog(recordRoll(setActivePlayer(newGame(board), 'b'), 8, {
    b: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
  }), 'Built a road'))
}

describe('history validation and boundaries', () => {
  it('starts a legacy history at the first end turn and keeps an existing history after roster changes', () => {
    const original = recorded()
    const { history: _, ...legacy } = original
    const ended = endTurn(legacy)
    expect(ended.history?.start).toEqual(positionOf(legacy))
    const removed = withBoard(original, removePlayer(original.board, 'b'))
    expect(parseGame(serializeGame(removed))).toEqual({ ok: true, game: removed })
    const restarted = setActivePlayer({ ...removed, turn: undefined }, 'aki')
    expect(restarted.history).toBe(original.history)
  })

  it('captures the ended position before bought dev cards become playable and clears optional position fields', () => {
    let game = setActivePlayer(newGame(createBoard('standard4')), 'aki')
    const initial = game
    game = adjustDevHand(game, 'bought', 'knight', 1)
    game = appendLog(game, 'Bought a dev card')
    const ended = endTurn(game)
    expect(historyGame(ended, 1).devHand).toEqual(game.devHand)
    expect(ended.devHand?.playable.knight).toBe(1)
    expect(historyGame(ended, 0).devHand).toBeUndefined()
    expect(historyGame(ended, 0).turn).toBe(ended.turn)
    expect(historyGame(ended, 1).turn?.log).toBeUndefined()
    expect(historyGame(ended, 1).turn?.gains).toBeUndefined()
    expect(positionOf(initial).buildings).toEqual([])
  })

  it('records upgrades and removals and does not alias parsed history or turn data', () => {
    const vertex = boardGrid('standard4').vertexIds[0]
    let game = setActivePlayer(newGame(placeBuilding(createBoard('standard4'), vertex, 'aki', 'settlement')), 'aki')
    game = withBoard(game, placeBuilding(game.board, vertex, 'aki', 'city'))
    game = endTurn(game)
    expect(game.history?.turns[0].buildings?.[vertex]?.tier).toBe('city')
    const raw = structuredClone(appendLog(game, 'Built a city'))
    const result = parseGame(raw)
    raw.history!.start.buildings[0].tier = 'superCity'
    raw.history!.start.stats.aki.hand.wood = 99
    raw.turn!.log!.push('Changed input')
    expect(result).toEqual({ ok: true, game: appendLog(game, 'Built a city') })
  })

  it.each([
    { b: { wood: -1 } }, { b: { wood: 0 } }, { b: { wood: 1.5 } },
    { b: { gold: 1 } }, { b: [] }, [], null,
  ])('rejects malformed turn gains %j', (gains) => {
    const raw = structuredClone(recorded())
    Object.assign(raw.turn!, { gains })
    expect(parseGame(raw).ok).toBe(false)
  })

  it.each<((raw: Game) => void)>([
    (raw) => { Object.assign(raw.history!, { extra: true }) },
    (raw) => { raw.history!.start.stats.b.hand.wood = -1 },
    (raw) => { Object.assign(raw.history!.start, { robber: { q: 0 } }) },
    (raw) => { raw.history!.turns[0].rolled = 13 },
    (raw) => { Object.assign(raw.history!.turns[0], { stats: { b: { hand: 1 } } }) },
    (raw) => { Object.assign(raw.history!.turns[0], { stats: [] }) },
    (raw) => { raw.history!.turns[0].roads = { invalid: 'b' } },
    (raw) => { raw.history!.turns[0].buildings = { invalid: null } },
    (raw) => { raw.history!.turns[0].gains = { b: { wood: -1 } } },
    (raw) => { Object.assign(raw.history!.turns[0], { awards: { largestArmy: 3, longestRoad: null } }) },
    (raw) => { Object.assign(raw.history!.turns[0], { devHand: { playerId: 'b' } }) },
  ])('drops damaged history while preserving the live game', (damage) => {
    const game = recorded()
    const raw = structuredClone(game)
    damage(raw)
    const { history: _, ...live } = game
    expect(parseGame(raw)).toEqual({ ok: true, game: live })
  })
})
