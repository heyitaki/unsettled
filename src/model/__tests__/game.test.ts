import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, removePlayer } from '../board'
import {
  adjustCounter,
  adjustHand,
  emptyStats,
  newGame,
  reconcileStats,
  validateGameStats,
  withBoard,
} from '../game'

describe('game state', () => {
  it('newGame zero-fills stats for every player', () => {
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    const game = newGame(board)
    expect(Object.keys(game.stats).sort()).toEqual(['aki', 'b'])
    expect(game.stats.aki).toEqual(emptyStats())
    expect(game.stats.aki.hand).toEqual({ wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 })
  })

  it('adjustHand adds, removes, and clamps at zero', () => {
    let game = newGame(createBoard('standard4'))
    game = adjustHand(game, 'aki', 'ore', 3)
    expect(game.stats.aki.hand.ore).toBe(3)
    game = adjustHand(game, 'aki', 'ore', -1)
    expect(game.stats.aki.hand.ore).toBe(2)
    game = adjustHand(game, 'aki', 'ore', -5)
    expect(game.stats.aki.hand.ore).toBe(0)
    expect(game.stats.aki.hand.wood).toBe(0)
  })

  it('adjustCounter tracks dev cards, knights, and vp cards independently', () => {
    let game = newGame(createBoard('standard4'))
    game = adjustCounter(game, 'aki', 'devCards', 2)
    game = adjustCounter(game, 'aki', 'knights', 1)
    game = adjustCounter(game, 'aki', 'vpCards', 1)
    expect(game.stats.aki).toMatchObject({ devCards: 2, knights: 1, vpCards: 1 })
    game = adjustCounter(game, 'aki', 'knights', -4)
    expect(game.stats.aki.knights).toBe(0)
  })

  it('mutators reject unknown players and no-op deltas return the same game', () => {
    const game = newGame(createBoard('standard4'))
    expect(() => adjustHand(game, 'ghost', 'wood', 1)).toThrow(RangeError)
    expect(() => adjustCounter(game, 'ghost', 'devCards', 1)).toThrow(RangeError)
    expect(adjustHand(game, 'aki', 'wood', -1)).toBe(game)
    expect(adjustCounter(game, 'aki', 'devCards', 0)).toBe(game)
  })

  it('withBoard reconciles stats with roster changes', () => {
    let game = newGame(createBoard('standard4'))
    game = adjustHand(game, 'aki', 'wheat', 2)

    const grown = addPlayer(game.board, { id: 'b', name: 'Bee', color: '#3063ba' })
    const withNew = withBoard(game, grown)
    expect(withNew.stats.b).toEqual(emptyStats())
    expect(withNew.stats.aki.hand.wheat).toBe(2)

    const shrunk = removePlayer(withNew.board, 'b')
    const withGone = withBoard(withNew, shrunk)
    expect(Object.keys(withGone.stats)).toEqual(['aki'])
  })

  it('withBoard returns the same game when nothing changed', () => {
    const game = newGame(createBoard('standard4'))
    expect(withBoard(game, game.board)).toBe(game)
  })

  it('reconcileStats keeps an aligned record by reference', () => {
    const board = createBoard('standard4')
    const stats = { aki: emptyStats() }
    expect(reconcileStats(stats, board.players)).toBe(stats)
  })

  it('zero-fills a player whose id shadows an Object.prototype member', () => {
    // `stats['toString'] ?? emptyStats()` would resolve to the inherited function,
    // so the player's stats became a function and the panel threw on hand.wood.
    // Indexed through a string-typed key so TS reads the record's index
    // signature rather than Object's own toString.
    const shadowed: string = 'toString'
    const hostile = [{ id: shadowed, name: 'X', color: '#ffffff' }, { id: 'aki', name: 'Aki', color: '#c1440e' }]
    const stats = reconcileStats({}, hostile)
    expect(stats[shadowed]).toEqual(emptyStats())
    expect(stats[shadowed].hand.wood).toBe(0)

    // The aligned fast path must not accept an inherited key as a real entry.
    const masked = reconcileStats({ aki: emptyStats(), hasOwnProperty: emptyStats() }, hostile)
    expect(masked[shadowed]).toEqual(emptyStats())
    expect(validateGameStats({ ...newGame(createBoard('standard4')), board: { ...createBoard('standard4'), players: hostile }, stats: { aki: emptyStats() } })
      .map((issue) => issue.code)).toContain('stats-missing-player')
  })

  it('validateGameStats flags dangling and missing entries', () => {
    const game = newGame(createBoard('standard4'))
    expect(validateGameStats(game)).toEqual([])
    const dangling = { ...game, stats: { ...game.stats, ghost: emptyStats() } }
    expect(validateGameStats(dangling).map((issue) => issue.code)).toContain('stats-unknown-player')
    const missing = { ...game, stats: {} }
    expect(validateGameStats(missing).map((issue) => issue.code)).toContain('stats-missing-player')
  })
})
