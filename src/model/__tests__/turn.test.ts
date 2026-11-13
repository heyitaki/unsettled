import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../board'
import { adjustCounter, adjustHand, emptyStats, newGame, type Game } from '../game'
import { edgeEndpointVertexIds } from '../coords'
import { boardGrid } from '../layouts'
import {
  activePlayerId,
  bankRate,
  bankPorts,
  isValidBankTrade,
  adjustDevHand,
  CARD_COSTS,
  endTurn,
  recordBankTrade,
  recordBuild,
  recordBuyDev,
  recordDiscard,
  recordPlayDev,
  recordPlayerTrade,
  recordRobber,
  recordRoll,
  setActivePlayer,
  turnState,
} from '../turn'

const hex = { q: 0, r: 0 }
const [edge, secondEdge] = boardGrid('standard4').edgeIds
const vertex = boardGrid('standard4').vertexIds[0]
const devCounts = () => ({ knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 })
const gameWithRival = () => newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }))
const total = (game: Game, id: string) => Object.values(game.stats[id].hand).reduce((sum, count) => sum + count, game.stats[id].handUnknown)

function freeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
}

describe('turn tracking', () => {
  it('defaults to the claimed player, not yet rolled', () => {
    const game = gameWithRival()
    expect(activePlayerId(game)).toBe('aki')
    expect(turnState(game)).toEqual({ playerId: 'aki', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } })
    expect(game.turn).toBeUndefined()
    const unclaimed = newGame(setMe(game.board, null))
    expect(activePlayerId(unclaimed)).toBeNull()
    expect(turnState(unclaimed)).toBeNull()
    const stored = setActivePlayer(unclaimed, 'b')
    expect(activePlayerId(stored)).toBe('b')
    expect(turnState(stored)).toBe(stored.turn)
  })

  it('setActivePlayer resets the turn flags and keeps progressPlayed', () => {
    const game = { ...gameWithRival(), turn: { playerId: 'aki', rolled: 8, devPlayed: true, progressPlayed: { roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 } } }
    const next = setActivePlayer(game, 'b')
    expect(next.turn).toEqual({ playerId: 'b', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 } })
    expect(setActivePlayer(game, 'aki')).toBe(game)
    expect(setActivePlayer(gameWithRival(), 'aki').turn).toEqual({ playerId: 'aki', rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } })
  })

  it('endTurn advances through all five seats and wraps to the first', () => {
    let board = gameWithRival().board
    for (const id of ['c', 'd', 'e']) board = addPlayer(board, { id, name: id, color: '#ffffff' })
    let game = { ...newGame(board), turn: { playerId: 'aki', rolled: 8 as number | null, devPlayed: true, progressPlayed: { roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 } } }
    for (const playerId of ['b', 'c', 'd', 'e', 'aki']) {
      const next = endTurn(game)
      expect(next.turn).toEqual({ playerId, rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 } })
      game = { ...next, turn: next.turn! }
    }
    expect(endTurn(newGame(createBoard('standard4'))).turn?.playerId).toBe('aki')
  })

  it('endTurn makes bought dev cards playable only for their owner', () => {
    const game = {
      ...setActivePlayer(gameWithRival(), 'b'),
      devHand: { playerId: 'aki', playable: { knight: 1, roadBuilding: 2, yearOfPlenty: 3, monopoly: 4 }, bought: { knight: 4, roadBuilding: 3, yearOfPlenty: 2, monopoly: 1 } },
    }
    const mine = endTurn(game)
    expect(mine.devHand).toBe(game.devHand)
    const next = endTurn(mine)
    expect(next.devHand).toEqual({ playerId: 'aki', playable: { knight: 5, roadBuilding: 5, yearOfPlenty: 5, monopoly: 5 }, bought: devCounts() })
  })

  it('recordRoll stores the total and credits every listed player', () => {
    const game = newGame(addPlayer(gameWithRival().board, { id: 'c', name: 'Cee', color: '#ffffff' }))
    const next = recordRoll(game, 8, { aki: { ...emptyStats().hand, wood: 2 }, b: { ...emptyStats().hand, ore: 1, wheat: 3 } })
    expect(next.turn).toEqual({ playerId: 'aki', rolled: 8, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } })
    expect(next.stats.aki.hand.wood).toBe(2)
    expect(next.stats.b.hand).toEqual({ wood: 0, sheep: 0, wheat: 3, brick: 0, ore: 1 })
    expect(next.stats.c).toBe(game.stats.c)
    const played = { ...next, turn: { ...next.turn!, devPlayed: true, progressPlayed: { roadBuilding: 1, yearOfPlenty: 0, monopoly: 1 } } }
    expect(recordRoll(played, 7, {}).turn).toEqual({ ...played.turn, rolled: 7, robberMoved: false })
    expect(recordRoll(game, 2, {}).turn?.rolled).toBe(2)
    expect(recordRoll(game, 12, {}).turn?.rolled).toBe(12)
  })

  it('recordRoll rejects totals outside 2 to 12', () => {
    for (const roll of [1, 13, 2.5, NaN, Infinity]) {
      expect(() => recordRoll(gameWithRival(), roll, {})).toThrow(RangeError)
    }
  })

  it('spending takes known cards first, then unknown ones', () => {
    let game = adjustCounter(adjustHand(gameWithRival(), 'aki', 'wood', 2), 'aki', 'handUnknown', 3)
    game = recordDiscard(game, 'aki', { wood: 1 })
    expect(game.stats.aki).toMatchObject({ hand: { wood: 1 }, handUnknown: 3 })
    game = recordDiscard(game, 'aki', { wood: 3 })
    expect(game.stats.aki).toMatchObject({ hand: { wood: 0 }, handUnknown: 1 })
    game = recordDiscard(game, 'aki', { ore: 4 })
    expect(game.stats.aki.handUnknown).toBe(0)
  })

  it('an unseen loss lowers every known count and the total by one', () => {
    const game = adjustCounter(adjustHand(gameWithRival(), 'aki', 'wood', 2), 'aki', 'handUnknown', 1)
    const next = recordDiscard(game, 'aki', 1)
    expect(next.stats.aki).toMatchObject({ hand: { wood: 1, ore: 0 }, handUnknown: 1 })
    expect(total(next, 'aki')).toBe(total(game, 'aki') - 1)
    const mixed = adjustHand(game, 'aki', 'ore', 2)
    const lost = recordDiscard(mixed, 'aki', 1)
    expect(lost.stats.aki).toMatchObject({ hand: { wood: 1, ore: 1 }, handUnknown: 2 })
    expect(total(lost, 'aki')).toBe(total(mixed, 'aki') - 1)
    expect(total(recordDiscard(lost, 'aki', 20), 'aki')).toBe(0)
  })

  it('a typed discard spends in the open and a counted discard is unseen', () => {
    const game = adjustHand(adjustHand(gameWithRival(), 'b', 'wood', 3), 'b', 'ore', 2)
    expect(recordDiscard(game, 'b', { wood: 2 }).stats.b).toMatchObject({ hand: { wood: 1, ore: 2 }, handUnknown: 0 })
    expect(recordDiscard(game, 'b', 2).stats.b).toMatchObject({ hand: { wood: 1, ore: 0 }, handUnknown: 2 })
  })

  it('a named steal moves one known card', () => {
    const game = adjustHand(gameWithRival(), 'b', 'ore', 2)
    const next = recordRobber(game, hex, 'b', 'ore')
    expect(next.board.robber).toEqual(hex)
    expect(next.stats.aki.hand.ore).toBe(1)
    expect(next.stats.b.hand.ore).toBe(1)
    const unknown = recordRobber(adjustCounter(gameWithRival(), 'b', 'handUnknown', 1), hex, 'b', 'ore')
    expect(unknown.stats.b.handUnknown).toBe(0)
    expect(unknown.stats.aki.hand.ore).toBe(1)
  })

  it('an unseen steal moves one unknown card', () => {
    const game = adjustCounter(adjustHand(gameWithRival(), 'b', 'wood', 2), 'b', 'handUnknown', 1)
    const next = recordRobber(game, hex, 'b', null)
    expect(next.stats.b).toMatchObject({ hand: { wood: 1 }, handUnknown: 1 })
    expect(next.stats.aki).toMatchObject({ hand: emptyStats().hand, handUnknown: 1 })
  })

  it('robbing a player with no cards only moves the robber', () => {
    const game = gameWithRival()
    for (const stolen of [null, 'wood'] as const) {
      const next = recordRobber(game, hex, 'b', stolen)
      expect(next).toEqual({ ...game, board: { ...game.board, robber: hex } })
    }
    const unclaimed = newGame(setMe(game.board, null))
    expect(recordRobber(unclaimed, hex, null, null)).toEqual({ ...unclaimed, board: { ...unclaimed.board, robber: hex } })
  })

  it('a bank trade spends the rate and gains the count', () => {
    const game = adjustHand(gameWithRival(), 'aki', 'wood', 4)
    const next = recordBankTrade(game, { wood: 4 }, { ore: 2 })
    expect(next.stats.aki.hand).toEqual({ wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 2 })
  })

  it('trades mixed whole port lots for multiple resources without mutating the game', () => {
    const base = gameWithRival()
    const ports = base.board.ports.slice(0, 2).map((port, index) => ({ ...port, resource: index === 0 ? 'ore' as const : null, rate: index === 0 ? 2 : 3 }))
    let board: Game['board'] = { ...base.board, ports }
    for (const port of ports) board = placeBuilding(board, edgeEndpointVertexIds(port.edgeId)[0], 'aki', 'settlement')
    const game = adjustCounter(adjustHand(newGame(board), 'aki', 'ore', 4), 'aki', 'handUnknown', 3)
    expect(bankPorts(board, 'aki')).toEqual(ports)
    expect(bankPorts(board, 'b')).toEqual([])
    expect(isValidBankTrade(board, 'aki', { ore: 4, wood: 3 }, { brick: 3 })).toBe(true)
    expect(isValidBankTrade(board, 'aki', { ore: 4, wood: 3 }, { brick: 2, sheep: 1 })).toBe(true)
    const before = structuredClone(game)
    freeze(game)
    const next = recordBankTrade(game, { ore: 4, wood: 3 }, { brick: 3 })
    expect(next.stats.aki).toMatchObject({ hand: { ore: 0, wood: 0, brick: 3 }, handUnknown: 0 })
    expect(next.stats.b).toBe(game.stats.b)
    expect(game).toEqual(before)
    for (const [gives, gets] of [
      [{ ore: 3, wood: 3 }, { brick: 3 }],
      [{ ore: 4, wood: 3 }, { brick: 2 }],
      [{ ore: 4, wood: 3 }, { brick: 4 }],
      [{ ore: 4 }, { ore: 2 }],
      [{}, { brick: 1 }],
      [{ ore: 4 }, {}],
      [{ ore: -2 }, { brick: 1 }],
      [{ ore: 2 }, { brick: 0.5, sheep: 0.5 }],
      [{ ore: Infinity }, { brick: Infinity }],
    ]) expect(isValidBankTrade(board, 'aki', gives, gets)).toBe(false)
    expect(isValidBankTrade(board, 'b', { ore: 4, wood: 4 }, { brick: 2 })).toBe(true)
    expect(isValidBankTrade(board, 'b', { ore: 2 }, { brick: 1 })).toBe(false)
  })

  it('a player trade moves cards both ways', () => {
    const game = adjustCounter(adjustHand(gameWithRival(), 'aki', 'wood', 3), 'b', 'handUnknown', 2)
    const next = recordPlayerTrade(game, 'b', { wood: 2 }, { ore: 1, wheat: 1 })
    expect(next.stats.aki.hand).toEqual({ wood: 1, sheep: 0, wheat: 1, brick: 0, ore: 1 })
    expect(next.stats.b).toMatchObject({ hand: { wood: 2, ore: 0, wheat: 0 }, handUnknown: 0 })
    expect(() => recordPlayerTrade(game, 'aki', {}, {})).toThrow(RangeError)
  })

  it('recordBuild places the piece and spends its cost', () => {
    expect(CARD_COSTS).toEqual({ road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 }, devCard: { sheep: 1, wheat: 1, ore: 1 } })
    const game = adjustCounter(gameWithRival(), 'aki', 'handUnknown', 10)
    const road = recordBuild(game, 'road', edge)
    expect(road.board.roads).toEqual([{ edgeId: edge, playerId: 'aki' }])
    expect(road.stats.aki.handUnknown).toBe(8)
    const settlement = recordBuild(game, 'settlement', vertex)
    expect(settlement.board.buildings).toEqual([{ vertexId: vertex, playerId: 'aki', tier: 'settlement' }])
    expect(settlement.stats.aki.handUnknown).toBe(6)
    const city = recordBuild(settlement, 'city', vertex)
    expect(city.board.buildings).toEqual([{ vertexId: vertex, playerId: 'aki', tier: 'city' }])
    expect(city.stats.aki.handUnknown).toBe(1)
  })

  it('a free road costs nothing', () => {
    const game = adjustHand(gameWithRival(), 'aki', 'wood', 1)
    const next = recordBuild(game, 'road', edge, { free: true })
    expect(next.board.roads).toEqual([{ edgeId: edge, playerId: 'aki' }])
    expect(next.stats).toEqual(game.stats)
  })

  it('recording the same road twice returns the first game by reference', () => {
    const first = recordBuild(adjustCounter(gameWithRival(), 'aki', 'handUnknown', 10), 'road', edge)
    expect(recordBuild(first, 'road', edge)).toBe(first)
  })

  it('playing a card held only in bought consumes its type and public count', () => {
    const game = adjustDevHand(gameWithRival(), 'bought', 'knight', 1)
    const next = recordPlayDev(game, { kind: 'knight', hex, victimId: null, stolen: null })
    expect(next.stats.aki.devCards).toBe(0)
    expect(next.devHand).toEqual({ playerId: 'aki', playable: devCounts(), bought: devCounts() })
  })

  it('playing a kind missing from the typed hand removes the typed hand', () => {
    const game = adjustCounter(adjustDevHand(gameWithRival(), 'playable', 'monopoly', 1), 'aki', 'devCards', 1)
    const next = recordPlayDev(game, { kind: 'knight', hex, victimId: null, stolen: null })
    expect(next.stats.aki.devCards).toBe(1)
    expect(next.devHand).toBeUndefined()
  })

  it('buying then tapping another seat makes the card playable on return', () => {
    const bought = recordBuyDev(gameWithRival(), 'knight')
    expect(setActivePlayer(bought, 'aki').devHand?.bought.knight).toBe(1)
    const away = setActivePlayer(bought, 'b')
    expect(away.devHand?.playable.knight).toBe(1)
    expect(away.devHand?.bought.knight).toBe(0)
    expect(endTurn(away).devHand?.playable.knight).toBe(1)
  })

  it('typing a dev card keeps the cards whose type is unknown', () => {
    const game = adjustCounter(gameWithRival(), 'aki', 'devCards', 2)
    const typed = adjustDevHand(game, 'playable', 'knight', 1)
    expect(typed.stats.aki.devCards).toBe(3)
    expect(adjustDevHand(typed, 'playable', 'knight', -1).stats.aki.devCards).toBe(2)
    expect(adjustDevHand(game, 'playable', 'knight', -1)).toMatchObject({ stats: { aki: { devCards: 2 } } })
  })

  it('lowering the public dev count below the typed sum removes the typed hand', () => {
    const game = adjustDevHand(adjustDevHand(gameWithRival(), 'playable', 'knight', 1), 'bought', 'monopoly', 1)
    const extra = adjustCounter(game, 'aki', 'devCards', 1)
    expect(adjustCounter(extra, 'aki', 'devCards', -1).devHand).toBe(game.devHand)
    const next = adjustCounter(game, 'aki', 'devCards', -1)
    expect(next.stats.aki.devCards).toBe(1)
    expect(next.devHand).toBeUndefined()
  })

  it('bank rates use the lowest matching owned port at either endpoint', () => {
    const base = gameWithRival().board
    const [port, other] = base.ports
    for (const vertex of edgeEndpointVertexIds(port.edgeId)) {
      const owned = placeBuilding({ ...base, ports: [{ ...port, resource: 'wood', rate: 2 }] }, vertex, 'aki', 'settlement')
      expect(bankRate(owned, 'aki', 'wood')).toBe(2)
      expect(bankRate(owned, 'aki', 'ore')).toBe(4)
      expect(bankRate(owned, 'b', 'wood')).toBe(4)
      const generic = { ...owned, ports: [{ ...port, resource: null, rate: 3 }] }
      expect(bankRate(generic, 'aki', 'ore')).toBe(3)
      const both = placeBuilding({ ...owned, ports: [{ ...other, resource: null, rate: 3 }, ...owned.ports] }, edgeEndpointVertexIds(other.edgeId)[0], 'aki', 'city')
      expect(bankRate(both, 'aki', 'wood')).toBe(2)
      expect(bankRate(both, 'aki', 'ore')).toBe(3)
    }
    expect(bankRate({ ...base, ports: [] }, 'aki', 'wood')).toBe(4)
  })

  it('buying a dev card files it under bought for the claimed player', () => {
    const game = adjustCounter(gameWithRival(), 'aki', 'handUnknown', 8)
    const next = recordBuyDev(game, 'knight')
    expect(next.stats.aki).toMatchObject({ handUnknown: 5, devCards: 1 })
    expect(next.devHand).toEqual({ playerId: 'aki', playable: devCounts(), bought: { ...devCounts(), knight: 1 } })
    expect(recordBuyDev(next, 'knight').devHand?.bought.knight).toBe(2)
    const stale = { ...game, devHand: { playerId: 'b', playable: { ...devCounts(), knight: 4 }, bought: devCounts() } }
    expect(recordBuyDev(stale, 'knight').devHand).toEqual(next.devHand)
    const unknown = recordBuyDev(game, null)
    expect(unknown.stats.aki.devCards).toBe(1)
    expect(unknown.devHand).toBeUndefined()
  })

  it("a rival's dev card purchase only raises the count", () => {
    const game = setActivePlayer(adjustDevHand(gameWithRival(), 'playable', 'knight', 1), 'b')
    const next = recordBuyDev(adjustCounter(game, 'b', 'handUnknown', 3), 'monopoly')
    expect(next.stats.b).toMatchObject({ handUnknown: 0, devCards: 1 })
    expect(next.devHand).toBe(game.devHand)
  })

  it('a drawn VP card raises vpCards, not devCards', () => {
    const game = adjustDevHand(adjustCounter(gameWithRival(), 'aki', 'handUnknown', 3), 'playable', 'knight', 2)
    const next = recordBuyDev(game, 'vp')
    expect(next.stats.aki).toMatchObject({ devCards: 2, vpCards: 1, handUnknown: 0 })
    expect(next.devHand).toBe(game.devHand)
  })

  it('a knight moves the robber, counts the knight and uses the card', () => {
    const game = adjustDevHand(adjustHand(gameWithRival(), 'b', 'ore', 1), 'playable', 'knight', 1)
    const next = recordPlayDev(game, { kind: 'knight', hex, victimId: 'b', stolen: 'ore' })
    expect(next.board.robber).toEqual(hex)
    expect(next.stats.aki).toMatchObject({ hand: { ore: 1 }, knights: 1, devCards: 0 })
    expect(next.stats.b.hand.ore).toBe(0)
    expect(next.devHand?.playable.knight).toBe(0)
    expect(next.turn).toEqual({ playerId: 'aki', rolled: null, devPlayed: true, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } })
  })

  it('monopoly collects from each named player', () => {
    const board = addPlayer(gameWithRival().board, { id: 'c', name: 'Cee', color: '#ffffff' })
    const game = adjustCounter(adjustHand(newGame(board), 'b', 'ore', 3), 'c', 'handUnknown', 2)
    const next = recordPlayDev(game, { kind: 'monopoly', resource: 'ore', taken: { b: 3, c: 2 } })
    expect(next.stats.aki.hand.ore).toBe(5)
    expect(next.stats.b.hand.ore).toBe(0)
    expect(next.stats.c.handUnknown).toBe(0)
    expect(next.stats.aki.devCards).toBe(0)
  })

  it('year of plenty gains two cards', () => {
    const game = gameWithRival()
    expect(recordPlayDev(game, { kind: 'yearOfPlenty', resources: ['wood', 'ore'] }).stats.aki.hand).toEqual({ wood: 1, sheep: 0, wheat: 0, brick: 0, ore: 1 })
    expect(recordPlayDev(game, { kind: 'yearOfPlenty', resources: ['ore', 'ore'] }).stats.aki.hand.ore).toBe(2)
  })

  it('progress cards raise progressPlayed and knights do not', () => {
    let game: Game & { turn: NonNullable<Game['turn']> } = { ...gameWithRival(), turn: { playerId: 'aki', rolled: 6, devPlayed: false, progressPlayed: { roadBuilding: 1, yearOfPlenty: 0, monopoly: 1 } } }
    for (const play of [
      { kind: 'roadBuilding', edges: [edge, secondEdge] },
      { kind: 'yearOfPlenty', resources: ['ore', 'ore'] },
      { kind: 'monopoly', resource: 'ore', taken: {} },
    ] as const) {
      freeze(game)
      const next = recordPlayDev(game, play)
      expect(next.turn).toEqual({ ...game.turn, devPlayed: true, progressPlayed: { ...game.turn.progressPlayed, [play.kind]: game.turn.progressPlayed[play.kind] + 1 } })
      game = { ...next, turn: next.turn! }
    }
    expect(game.board.roads).toEqual([{ edgeId: edge, playerId: 'aki' }, { edgeId: secondEdge, playerId: 'aki' }])
    expect(recordPlayDev(game, { kind: 'knight', hex, victimId: null, stolen: null }).turn?.progressPlayed).toEqual({ roadBuilding: 2, yearOfPlenty: 1, monopoly: 2 })
  })

  it('road building places zero to two roads free and uses a playable card', () => {
    const game = adjustDevHand(adjustDevHand(adjustHand(gameWithRival(), 'aki', 'wood', 2), 'playable', 'roadBuilding', 1), 'bought', 'roadBuilding', 1)
    for (const edges of [[], [edge], [edge, secondEdge]] as const) {
      const next = recordPlayDev(game, { kind: 'roadBuilding', edges })
      expect(next.board.roads.map((road) => road.edgeId)).toEqual(edges)
      expect(next.stats.aki.hand).toEqual(game.stats.aki.hand)
      expect(next.stats.aki.devCards).toBe(1)
      expect(next.devHand).toEqual({ ...game.devHand, playable: devCounts() })
    }
    const rivalTurn = setActivePlayer(game, 'b')
    const rival = recordPlayDev(rivalTurn, { kind: 'roadBuilding', edges: [] })
    expect(rival.devHand).toBe(rivalTurn.devHand)
    expect(rival.stats.b.devCards).toBe(0)
  })

  it('adjustDevHand moves devCards by the typed change', () => {
    let game = adjustCounter(gameWithRival(), 'aki', 'devCards', 8)
    game = adjustDevHand(game, 'playable', 'knight', 2)
    game = adjustDevHand(game, 'bought', 'monopoly', 3)
    expect(game.stats.aki.devCards).toBe(13)
    game = adjustDevHand(game, 'playable', 'knight', -10)
    expect(game.stats.aki.devCards).toBe(11)
    expect(game.devHand?.playable.knight).toBe(0)
    const rivalTurn = adjustDevHand(setActivePlayer(game, 'b'), 'bought', 'roadBuilding', 1)
    expect(rivalTurn.stats.aki.devCards).toBe(12)
    expect(rivalTurn.stats.b.devCards).toBe(0)
    const stale = { ...game, devHand: { playerId: 'b', playable: { ...devCounts(), knight: 5 }, bought: devCounts() } }
    expect(adjustDevHand(stale, 'bought', 'monopoly', 1).devHand).toEqual({ playerId: 'aki', playable: devCounts(), bought: { ...devCounts(), monopoly: 1 } })
  })

  it('actions needing an active or claimed player reject their absence', () => {
    const game = newGame(setMe(gameWithRival().board, null))
    const actions = [
      () => endTurn(game),
      () => recordRoll(game, 6, {}),
      () => recordRobber(game, hex, 'b', null),
      () => recordBankTrade(game, { wood: 1 }, { ore: 1 }),
      () => recordPlayerTrade(game, 'b', {}, {}),
      () => recordBuild(game, 'road', edge),
      () => recordBuyDev(game, null),
      () => recordPlayDev(game, { kind: 'roadBuilding', edges: [] }),
      () => adjustDevHand(setActivePlayer(game, 'b'), 'playable', 'knight', 1),
    ]
    for (const action of actions) expect(action).toThrow(RangeError)
    const holding = adjustHand(adjustCounter(game, 'b', 'handUnknown', 2), 'b', 'wood', 2)
    const discarded = recordDiscard(holding, 'b', 1)
    expect(discarded.stats.b).toMatchObject({ hand: { wood: 1 }, handUnknown: 2 })
    expect(total(discarded, 'b')).toBe(3)
    expect(discarded.stats.aki).toBe(holding.stats.aki)
    expect(discarded.turn).toBeUndefined()
  })

  it('unknown player ids are rejected even when they name prototype members', () => {
    const game = gameWithRival()
    for (const id of ['missing', 'toString', '__proto__']) {
      expect(() => setActivePlayer(game, id)).toThrow(RangeError)
      expect(() => recordRoll(game, 6, { [id]: emptyStats().hand })).toThrow(RangeError)
      expect(() => recordDiscard(game, id, {})).toThrow(RangeError)
      expect(() => recordDiscard(game, id, 0)).toThrow(RangeError)
      expect(() => recordRobber(game, hex, id, null)).toThrow(RangeError)
      expect(() => recordPlayerTrade(game, id, {}, {})).toThrow(RangeError)
      expect(() => recordPlayDev(game, { kind: 'monopoly', resource: 'ore', taken: { [id]: 0 } })).toThrow(RangeError)
    }
  })

  it('player ids that shadow prototype members work when rostered', () => {
    for (const id of ['toString', '__proto__']) {
      const game = newGame(addPlayer(gameWithRival().board, { id, name: 'X', color: '#ffffff' }))
      const rolled = recordRoll(game, 6, { [id]: { ...emptyStats().hand, ore: 3 } })
      expect(rolled.stats[id].hand.ore).toBe(3)
      const played = recordPlayDev(rolled, { kind: 'monopoly', resource: 'ore', taken: { [id]: 2 } })
      expect(played.stats[id].hand.ore).toBe(1)
      expect(played.stats.aki.hand.ore).toBe(2)
      expect(recordBuyDev(setActivePlayer(game, id), null).stats[id].devCards).toBe(1)
    }
    const inherited = Object.create({ toString: emptyStats().hand }) as Record<string, Record<keyof ReturnType<typeof emptyStats>['hand'], number>>
    expect(recordRoll(gameWithRival(), 6, inherited).stats).toEqual(gameWithRival().stats)
  })

  it('no function mutates its input', () => {
    let game = adjustDevHand(gameWithRival(), 'playable', 'knight', 2)
    game = adjustDevHand(game, 'bought', 'roadBuilding', 1)
    game = adjustCounter(adjustHand(game, 'aki', 'wood', 3), 'aki', 'handUnknown', 10)
    game = adjustCounter(adjustHand(game, 'b', 'ore', 2), 'b', 'handUnknown', 2)
    game = recordRoll(game, 6, {})
    const before = structuredClone(game)
    freeze(game)
    activePlayerId(game)
    turnState(game)
    setActivePlayer(game, 'b')
    endTurn(game)
    recordRoll(game, 8, { b: { ...emptyStats().hand, wood: 2 } })
    recordDiscard(game, 'b', { ore: 1 })
    recordDiscard(game, 'b', 2)
    recordRobber(game, hex, 'b', 'ore')
    recordRobber(game, hex, 'b', null)
    recordBankTrade(game, { wood: 2 }, { ore: 1 })
    recordPlayerTrade(game, 'b', { wood: 1 }, { ore: 1 })
    recordBuild(game, 'road', edge)
    recordBuild(game, 'settlement', vertex)
    recordBuild(game, 'city', vertex)
    recordBuyDev(game, 'knight')
    recordBuyDev(game, 'vp')
    recordPlayDev(game, { kind: 'knight', hex, victimId: 'b', stolen: 'ore' })
    recordPlayDev(game, { kind: 'roadBuilding', edges: [edge, secondEdge] })
    recordPlayDev(game, { kind: 'yearOfPlenty', resources: ['ore', 'ore'] })
    recordPlayDev(game, { kind: 'monopoly', resource: 'ore', taken: { b: 2 } })
    adjustDevHand(game, 'playable', 'knight', -1)
    expect(game).toEqual(before)
  })
})
