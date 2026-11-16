import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, removePlayer, setMe, setRobber } from '../board'
import { parseGame, serializeGame } from '../serialization'
import { boardGrid } from '../layouts'
import { PLAYER_PALETTE, type Board } from '../types'
import {
  adjustCounter,
  adjustHand,
  emptyStats,
  type Game,
  mergeScreenshot,
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

  it('adjustCounter tracks cards with an unknown resource', () => {
    let game = newGame(createBoard('standard4'))
    game = adjustCounter(game, 'aki', 'handUnknown', 3)
    expect(game.stats.aki.handUnknown).toBe(3)
    game = adjustCounter(game, 'aki', 'handUnknown', -5)
    expect(game.stats.aki.handUnknown).toBe(0)
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

it('withBoard drops turn and devHand when their player leaves', () => {
  const game = {
    ...newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })),
    turn: { playerId: 'b', rolled: 6, devPlayed: true, progressPlayed: { roadBuilding: 1, yearOfPlenty: 0, monopoly: 1 } },
    devHand: {
      playerId: 'b',
      playable: { knight: 1, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
      bought: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 1 },
    },
  }
  expect(withBoard(game, game.board)).toBe(game)
  const board = removePlayer(game.board, 'b')
  const removed = withBoard(game, board)
  expect(Object.hasOwn(removed, 'turn')).toBe(false)
  expect(Object.hasOwn(removed, 'devHand')).toBe(false)
  expect(removed.stats).toEqual({ aki: emptyStats() })
  const myTurn = withBoard({ ...game, turn: { ...game.turn, playerId: 'aki' } }, board)
  expect(myTurn.turn?.playerId).toBe('aki')
  expect(Object.hasOwn(myTurn, 'devHand')).toBe(false)
  const myHand = withBoard({ ...game, devHand: { ...game.devHand, playerId: 'aki' } }, board)
  expect(myHand.devHand?.playerId).toBe('aki')
  expect(Object.hasOwn(myHand, 'turn')).toBe(false)
  expect(withBoard(game, { ...game.board }).turn).toBe(game.turn)
  expect(withBoard(game, { ...game.board }).devHand).toBe(game.devHand)
})

describe('mergeScreenshot', () => {
  const [vertexA, vertexB] = [boardGrid('standard4').vertexIds[0], boardGrid('standard4').vertexIds.at(-1)!]
  const [edgeA] = boardGrid('standard4').edgeIds
  const blue = { name: 'Blue', color: PLAYER_PALETTE.blue }
  const white = { name: 'White', color: PLAYER_PALETTE.white }
  // Pills for everyone, every hand size read.
  const pills = (hands = ['p1', 'p2', 'p3']) => ({ roster: true, order: true, picks: true, hands, unorderedPicks: [], points: {}, knights: [] })
  const empty = (): Board => ({ ...createBoard('standard4'), players: [], mePlayerId: null })

  // Saved: aki (red, claimed) and a renamed blue player, with hand-entered stats.
  const saved = (): Game => {
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue })
    const game = newGame(setRobber(board, board.hexes[3].coord))
    return {
      ...game,
      stats: {
        aki: { ...emptyStats(), hand: { ...emptyStats().hand, ore: 2 }, devCards: 1, knights: 1 },
        b: { ...emptyStats(), handUnknown: 3, knights: 2, vpCards: 1 },
      },
      awards: { longestRoad: null, largestArmy: null },
      turn: { playerId: 'b', rolled: 8, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } },
    }
  }

  // Parsed: ids follow pill order, names are colour names, and a third player joined.
  const shot = (hands: [number, number, number] = [5, 4, 1]): Game => {
    let board = addPlayer(empty(), { id: 'p1', ...blue })
    board = addPlayer(board, { id: 'p2', name: 'Red', color: PLAYER_PALETTE.red })
    board = addPlayer(board, { id: 'p3', ...white })
    board = placeBuilding(board, vertexA, 'p2', 'settlement')
    board = placeBuilding(board, vertexB, 'p3', 'city')
    board = placeRoad(board, edgeA, 'p2')
    const game = newGame(setRobber(setMe(board, 'p1'), board.hexes[5].coord))
    hands.forEach((count, index) => { game.stats[`p${index + 1}`].handUnknown = count })
    return game
  }

  it('keeps saved ids, names and the claim, and takes the roster order and pieces from the screenshot', () => {
    const merged = mergeScreenshot(saved(), shot(), pills())
    expect(merged.board.players).toEqual([
      { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue },
      { id: 'aki', name: 'aki', color: PLAYER_PALETTE.red },
      { id: 'p3', ...white },
    ])
    expect(merged.board.buildings).toEqual([
      { vertexId: vertexA, playerId: 'aki', tier: 'settlement' },
      { vertexId: vertexB, playerId: 'p3', tier: 'city' },
    ])
    expect(merged.board.roads).toEqual([{ edgeId: edgeA, playerId: 'aki' }])
    expect(merged.board.robber).toEqual(shot().board.robber)
    expect(merged.board.mePlayerId).toBe('aki')
    // What the autosave writes must be what the library can read back.
    expect(parseGame(JSON.parse(serializeGame(merged)))).toEqual({ ok: true, game: merged })
  })

  it('keeps hand-entered counters, the turn and the awards', () => {
    const before = saved()
    const merged = mergeScreenshot(before, shot(), pills())
    expect(merged.stats.b).toEqual({ ...emptyStats(), handUnknown: 5, knights: 2, vpCards: 1 })
    expect(merged.stats.p3).toEqual({ ...emptyStats(), handUnknown: 1 })
    expect(merged.turn).toBe(before.turn)
    expect(merged.awards).toBe(before.awards)
  })

  it('keeps known cards while the screenshot count has room for them', () => {
    const known = { ...emptyStats(), hand: { ...emptyStats().hand, ore: 2 }, devCards: 1, knights: 1 }
    expect(mergeScreenshot(saved(), shot([5, 4, 1]), pills()).stats.aki).toEqual({ ...known, handUnknown: 2 })
    expect(mergeScreenshot(saved(), shot([5, 2, 1]), pills()).stats.aki).toEqual(known)
    expect(mergeScreenshot(saved(), shot([5, 1, 1]), pills()).stats.aki)
      .toEqual({ ...emptyStats(), handUnknown: 1, devCards: 1, knights: 1 })
  })

  it('keeps the saved hand of a player whose hand size was not read', () => {
    const before = saved()
    // Red's pill was unreadable, so its parsed zero says nothing.
    const merged = mergeScreenshot(before, shot([5, 0, 1]), pills(['p1', 'p3']))
    expect(merged.stats.aki).toEqual(before.stats.aki)
    expect(merged.stats.b.handUnknown).toBe(5)
    // The same zero, read: the hand really is empty.
    expect(mergeScreenshot(before, shot([5, 0, 1]), pills()).stats.aki)
      .toEqual({ ...emptyStats(), devCards: 1, knights: 1 })
  })

  it('keeps the saved robber when the screenshot found none', () => {
    const before = saved()
    const parsed = shot()
    const merged = mergeScreenshot(before, { ...parsed, board: { ...parsed.board, robber: null } }, pills())
    expect(merged.board.robber).toEqual(before.board.robber)
  })

  it('never hands a newcomer a saved id, matched or departed', () => {
    // Saved green is `p2`, on turn and holding typed dev cards; the screenshot
    // has no green, and calls its new blue player `p2`.
    let before = newGame(addPlayer(createBoard('standard4'), { id: 'p2', name: 'Gina', color: PLAYER_PALETTE.green }))
    before = {
      ...before,
      stats: { ...before.stats, p2: { ...emptyStats(), devCards: 1 } },
      turn: { playerId: 'p2', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } },
      devHand: {
        playerId: 'p2',
        playable: { knight: 1, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
        bought: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
      },
    }
    let board = addPlayer(empty(), { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red })
    board = placeBuilding(addPlayer(board, { id: 'p2', ...blue }), vertexA, 'p2', 'settlement')
    const merged = mergeScreenshot(before, newGame(board), pills())
    const [red, newcomer] = merged.board.players
    expect(red.id).toBe('aki')
    expect(newcomer).toEqual({ id: 'p2-2', ...blue })
    expect(merged.board.buildings[0].playerId).toBe('p2-2')
    expect(Object.keys(merged.stats)).toEqual(['aki', 'p2-2'])
    expect(merged.stats['p2-2']).toEqual(emptyStats())
    expect(Object.hasOwn(merged, 'turn')).toBe(false)
    expect(Object.hasOwn(merged, 'devHand')).toBe(false)
  })

  it('falls back to the screenshot claim when the claimed player is gone', () => {
    // Saved red is claimed; the screenshot has no red player.
    const merged = mergeScreenshot(saved(), newGame(setMe(addPlayer(empty(), { id: 'p1', ...blue }), 'p1')), pills())
    expect(merged.board.players.map((player) => player.id)).toEqual(['b'])
    expect(merged.board.mePlayerId).toBe('b')
  })

  it('drops nobody when the screenshot had no pills, only pieces', () => {
    const before = saved()
    // Colours with pieces are all such a screenshot knows: blue, and a white newcomer.
    let board = addPlayer(empty(), { id: 's-white', ...white })
    board = addPlayer(board, { id: 's-blue', ...blue })
    board = placeBuilding(board, vertexA, 's-blue', 'settlement')
    board = placeBuilding(board, vertexB, 's-white', 'settlement')
    const merged = mergeScreenshot(before, newGame(board), { roster: false, order: false, picks: false, hands: [], unorderedPicks: [], points: {}, knights: [] })
    expect(merged.board.players).toEqual([...before.board.players, { id: 's-white', ...white }])
    expect(merged.board.buildings.map((building) => building.playerId)).toEqual(['b', 's-white'])
    expect(merged.board.mePlayerId).toBe('aki')
    expect(merged.stats).toEqual({ ...before.stats, 's-white': emptyStats() })
    expect(merged.turn).toBe(before.turn)
  })

  it('keeps the saved seat order when the screenshot showed the players but not who goes first', () => {
    const merged = mergeScreenshot(saved(), shot(), { ...pills(), order: false })
    expect(merged.board.players.map((player) => player.id)).toEqual(['aki', 'b', 'p3'])
    // A player the screenshot no longer shows still leaves.
    const gone = mergeScreenshot(saved(), newGame(setMe(addPlayer(empty(), { id: 'p1', ...blue }), 'p1')), { ...pills(), order: false })
    expect(gone.board.players.map((player) => player.id)).toEqual(['b'])
  })

  it('keeps the saved order of buildings when the screenshot could not tell which came first', () => {
    const [first, second] = [boardGrid('standard4').vertexIds[20], boardGrid('standard4').vertexIds[40]]
    const before = newGame(placeBuilding(placeBuilding(createBoard('standard4'), first, 'aki', 'settlement'), second, 'aki', 'settlement'))
    // The screenshot lists red's settlements the other way round, one now a city, beside a newcomer's.
    let board = addPlayer(empty(), { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red })
    board = addPlayer(board, { id: 'p2', ...blue })
    board = placeBuilding(board, second, 'p1', 'settlement')
    board = placeBuilding(board, vertexB, 'p2', 'settlement')
    board = placeBuilding(board, first, 'p1', 'city')
    const merged = mergeScreenshot(before, newGame(board), { ...pills(['p1', 'p2']), picks: false })
    expect(merged.board.buildings).toEqual([
      { vertexId: first, playerId: 'aki', tier: 'city' },
      { vertexId: second, playerId: 'aki', tier: 'settlement' },
      { vertexId: vertexB, playerId: 'p2', tier: 'settlement' },
    ])
    // A screenshot that shows the order wins.
    expect(mergeScreenshot(before, newGame(board), pills(['p1', 'p2'])).board.buildings.map((building) => building.vertexId))
      .toEqual([second, vertexB, first])
  })
})
