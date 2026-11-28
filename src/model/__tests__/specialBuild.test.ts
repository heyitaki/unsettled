import { describe, expect, it } from 'vitest'
import { createBoard } from '../board'
import { adjustHand, newGame, type Game, type SpecialBuildRule } from '../game'
import { historyGame } from '../history'
import { parseGame, serializeGame } from '../serialization'
import { appendSpecialBuild, endTurn, recordBuyDev, setActivePlayer, specialBuilders } from '../turn'

const COLORS = ['#c23f38', '#3063ba', '#e58331', '#ffffff', '#4f9a3a', '#7a4f2a']

/** A started game at `seats` players on seat `turnSeat`'s turn, every hand at `cards` wheat. */
function game(seats: number, rule: SpecialBuildRule | undefined, turnSeat = 0, cards = 0): Game {
  const players = COLORS.slice(0, seats).map((color, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, color }))
  let next: Game = { ...newGame({ ...createBoard('extension6'), players, mePlayerId: 'p1' }), ...(rule ? { specialBuild: rule } : {}) }
  for (const { id } of players) next = adjustHand(next, id, 'wheat', cards)
  return setActivePlayer(next, players[turnSeat].id)
}

const everyTurn = { timing: 'everyTurn', who: 'always' } as const
const across = { timing: 'across', who: 'always' } as const

describe('special build timing', () => {
  it('is off without a rule, and below five seats', () => {
    expect(specialBuilders(game(5, undefined))).toEqual([])
    expect(specialBuilders(game(4, everyTurn))).toEqual([])
  })

  it('every turn offers every other player, from the next seat on', () => {
    expect(specialBuilders(game(5, everyTurn, 2))).toEqual(['p4', 'p5', 'p1', 'p2'])
    expect(specialBuilders(game(6, everyTurn, 5))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('across offers only the player three seats back', () => {
    // After player 4 and before player 5, player 1 builds, as if player 1's turn came round on a four player board.
    expect(specialBuilders(game(5, across, 3))).toEqual(['p1'])
    expect(specialBuilders(game(5, across, 0))).toEqual(['p3'])
    expect(specialBuilders(game(6, across, 4))).toEqual(['p2'])
    expect(specialBuilders(game(6, across, 1))).toEqual(['p5'])
  })

  it('across gives each player exactly one build per round', () => {
    for (const seats of [5, 6]) {
      const builders = Array.from({ length: seats }, (_, seat) => specialBuilders(game(seats, across, seat))).flat()
      expect(builders.toSorted()).toEqual(Array.from({ length: seats }, (_, index) => `p${index + 1}`))
    }
  })
})

describe('special build eligibility', () => {
  const overSeven = { timing: 'everyTurn', who: 'overSeven' } as const

  it('over seven keeps only players holding more than seven cards', () => {
    let start = game(5, overSeven, 0, 7)
    start = adjustHand(start, 'p3', 'ore', 1)
    expect(specialBuilders(start)).toEqual(['p3'])
    expect(specialBuilders(game(5, overSeven, 0, 8))).toEqual(['p2', 'p3', 'p4', 'p5'])
  })

  it('a player who built drops out once at seven cards or fewer', () => {
    let start = game(5, overSeven, 0, 7)
    start = adjustHand(adjustHand(start, 'p2', 'sheep', 1), 'p2', 'ore', 1)
    const built = appendSpecialBuild(recordBuyDev(start, null, { playerId: 'p2' }), 'p2', 'Bought a dev card')
    expect(Object.values(built.stats.p2.hand).reduce((sum, count) => sum + count, 0)).toBe(6)
    expect(specialBuilders(built)).toEqual([])
  })

  it('across with over seven needs the one eligible player to hold more than seven', () => {
    expect(specialBuilders(game(5, { timing: 'across', who: 'overSeven' }, 3, 7))).toEqual([])
    expect(specialBuilders(game(5, { timing: 'across', who: 'overSeven' }, 3, 8))).toEqual(['p1'])
  })
})

describe('special build recording', () => {
  it('a special buy leaves the turn player alone and makes a typed card playable next turn', () => {
    const start = adjustHand(adjustHand(adjustHand(game(5, everyTurn, 2), 'p1', 'sheep', 1), 'p1', 'wheat', 1), 'p1', 'ore', 1)
    const bought = recordBuyDev(start, 'knight', { playerId: 'p1' })
    expect(bought.turn?.devBought).toBeUndefined()
    expect(bought.stats.p1.devCards).toBe(1)
    expect(bought.devHand?.playable.knight).toBe(1)
    expect(bought.devHand?.bought.knight).toBe(0)
  })

  it('lines move into the turn record, round-trip through storage, and leave past turns', () => {
    const built = appendSpecialBuild(game(5, everyTurn), 'p3', 'Built a road')
    const ended = endTurn(built)
    expect(ended.history?.turns[0].specialBuilds).toEqual([{ playerId: 'p3', text: 'Built a road' }])
    expect(ended.turn?.specialBuilds).toBeUndefined()
    expect(historyGame(appendSpecialBuild(ended, 'p4', 'Built a city'), 1).turn?.specialBuilds).toBeUndefined()
    const parsed = parseGame(serializeGame(built))
    expect(parsed.ok && parsed.game.turn?.specialBuilds).toEqual([{ playerId: 'p3', text: 'Built a road' }])
    expect(parsed.ok && parsed.game.specialBuild).toEqual(everyTurn)
    expect(parseGame({ ...JSON.parse(serializeGame(built)), specialBuild: { timing: 'sometimes', who: 'always' } }).ok).toBe(false)
  })
})
