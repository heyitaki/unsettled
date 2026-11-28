import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../board'
import { adjustCounter, emptyStats, newGame, withUnseenCards, type Game, type PlayerStats } from '../game'
import { boardGrid } from '../layouts'
import { recordBuild, recordDiscard, recordPlayDev, recordPlayerTrade, recordRobber, setActivePlayer } from '../turn'
import { parseGame, serializeGame } from '../serialization'
import type { Resource } from '../types'

const hex = { q: 0, r: 0 }
type Hand = Partial<Record<Resource, number>>

/** Aki on turn, rival Bee holding `hand` plus `unseen` cards, each listed by the types it could be. */
function withHands(bee: Hand, unseen: Resource[][] = [], aki: Hand = {}, akiUnseen: Resource[][] = []): Game {
  const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  const game = setActivePlayer(newGame(board), 'aki')
  const stats = (hand: Hand, cards: Resource[][]): PlayerStats => withUnseenCards(emptyStats(), { ...emptyStats().hand, ...hand }, cards)
  return { ...game, stats: { aki: stats(aki, akiUnseen), b: stats(bee, unseen) } }
}

const ANY: Resource[] = ['wood', 'sheep', 'wheat', 'brick', 'ore']
const known = (game: Game, id: string) => Object.fromEntries(Object.entries(game.stats[id].hand).filter(([, count]) => count > 0))

describe('narrowed unseen cards', () => {
  it('a steal from a wood and brick hand leaves both sides a wood-or-brick card', () => {
    const next = recordRobber(withHands({ wood: 2, brick: 1 }), hex, 'b', null)
    expect(next.stats.aki).toMatchObject({ handUnknown: 1, handUnknownAmong: [['wood', 'brick']] })
    expect(known(next, 'aki')).toEqual({})
    // Bee lost wood (keeps wood and brick) or brick (keeps two wood): one wood is certain.
    expect(next.stats.b).toMatchObject({ handUnknown: 1, handUnknownAmong: [['wood', 'brick']] })
    expect(known(next, 'b')).toEqual({ wood: 1 })
  })

  it('a steal from a one-type hand is a known card', () => {
    const next = recordRobber(withHands({ ore: 2 }), hex, 'b', null)
    expect(known(next, 'aki')).toEqual({ ore: 1 })
    expect(next.stats.aki.handUnknown).toBe(0)
    expect(known(next, 'b')).toEqual({ ore: 1 })
  })

  it('a steal from a hand with a card that could be anything stays plain', () => {
    const next = recordRobber(withHands({ wood: 1 }, [ANY]), hex, 'b', null)
    expect(next.stats.aki.handUnknown).toBe(1)
    expect(next.stats.aki.handUnknownAmong).toBeUndefined()
  })

  it('a steal of a narrowed card passes the narrowing on', () => {
    const next = recordRobber(withHands({}, [['sheep', 'ore']]), hex, 'b', null)
    expect(next.stats.aki).toMatchObject({ handUnknown: 1, handUnknownAmong: [['sheep', 'ore']] })
    expect(next.stats.b.handUnknown).toBe(0)
  })

  it('a counted 7 discard keeps the cards left to the types the hand held', () => {
    const next = recordDiscard(withHands({ wood: 3, ore: 2 }), 'b', 2)
    expect(known(next, 'b')).toEqual({ wood: 1 })
    expect(next.stats.b).toMatchObject({ handUnknown: 2, handUnknownAmong: [['wood', 'ore'], ['wood', 'ore']] })
    // Discarding every card but one of a single type left is still exact.
    expect(known(recordDiscard(withHands({ sheep: 4 }), 'b', 2), 'b')).toEqual({ sheep: 2 })
  })

  it('a build reveals which type a narrowed card was', () => {
    const game = withHands({}, [], { brick: 1 }, [['wood', 'brick']])
    const next = recordBuild(game, 'road', boardGrid('standard4').edgeIds[0])
    expect(next.stats.aki).toMatchObject({ handUnknown: 0 })
    expect(next.stats.aki.handUnknownAmong).toBeUndefined()
    expect(known(next, 'aki')).toEqual({})
  })

  it('spending a type only one card could be resolves the others', () => {
    const game = withHands({}, [], {}, [['wood', 'brick'], ['sheep', 'ore']])
    const next = recordPlayerTrade(game, 'b', { brick: 1 }, { wheat: 1 })
    // The sheep-or-ore card stays narrowed; the wood-or-brick one was the brick.
    expect(next.stats.aki).toMatchObject({ handUnknown: 1, handUnknownAmong: [['sheep', 'ore']] })
    expect(known(next, 'b')).toEqual({ brick: 1 })
  })

  it('spending a type two cards could be widens the one left to both', () => {
    const game = withHands({}, [], {}, [['wood', 'brick'], ['brick', 'ore']])
    const next = recordPlayerTrade(game, 'b', { brick: 1 }, { wheat: 1 })
    expect(next.stats.aki).toMatchObject({ handUnknown: 1, handUnknownAmong: [['wood', 'brick', 'ore']] })
  })

  it('spending a type no unseen card could be still drops a card', () => {
    const game = withHands({}, [], {}, [['wood', 'brick'], ['sheep', 'wheat', 'brick']])
    const next = recordPlayerTrade(game, 'b', { ore: 1 }, { wheat: 1 })
    expect(next.stats.aki).toMatchObject({ handUnknown: 1, handUnknownAmong: [['wood', 'brick']] })
  })

  it('a monopoly rules its type out of every other unseen card', () => {
    const next = recordPlayDev(withHands({}, [['wood', 'brick'], ANY]), { kind: 'monopoly', resource: 'wood', taken: { b: 0 } })
    expect(known(next, 'b')).toEqual({ brick: 1 })
    expect(next.stats.b).toMatchObject({ handUnknown: 1, handUnknownAmong: [['sheep', 'wheat', 'brick', 'ore']] })
  })

  it('taking back unseen cards drops plain ones before narrowed ones', () => {
    const game = withHands({}, [['wood', 'brick'], ANY])
    const one = adjustCounter(game, 'b', 'handUnknown', -1)
    expect(one.stats.b).toMatchObject({ handUnknown: 1, handUnknownAmong: [['wood', 'brick']] })
    expect(adjustCounter(one, 'b', 'handUnknown', -1).stats.b.handUnknownAmong).toBeUndefined()
  })

  it('narrowed cards survive a save and a malformed list is rejected', () => {
    const game = withHands({ wood: 1 }, [['wood', 'ore'], ['wood', 'ore'], ANY])
    expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
    const bad = (handUnknownAmong: unknown, handUnknown = 1) =>
      parseGame({ ...game, stats: { ...game.stats, b: { ...emptyStats(), handUnknown, handUnknownAmong } } })
    expect(bad([['wood']])).toMatchObject({ ok: false })
    expect(bad([ANY])).toMatchObject({ ok: false })
    expect(bad([['wood', 'wood']])).toMatchObject({ ok: false })
    expect(bad([['wood', 'gold']])).toMatchObject({ ok: false })
    expect(bad([['wood', 'ore']], 0)).toMatchObject({ ok: false })
    expect(bad([])).toMatchObject({ ok: false })
  })
})
