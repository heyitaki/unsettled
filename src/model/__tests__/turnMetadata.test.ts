import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../board'
import { newGame } from '../game'
import { parseGame } from '../serialization'
import { currentTurnHistory, endTurn, recordBuyDev, recordPlayDev, recordRobber, recordRoll, setActivePlayer } from '../turn'

const initial = newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }))

describe('turn recording metadata', () => {
  it('records a seven as pending until its robber move, including a Knight move', () => {
    const seven = recordRoll(initial, 7, {})
    expect(seven.turn?.robberMoved).toBe(false)
    expect(recordRobber(seven, { q: 0, r: 1 }, null, null).turn?.robberMoved).toBe(true)
    expect(recordPlayDev(seven, { kind: 'knight', hex: { q: 0, r: 1 }, victimId: null, stolen: null }).turn?.robberMoved).toBe(true)
    expect(recordRoll(seven, 8, {}).turn).not.toHaveProperty('robberMoved')
    expect(initial.turn).toBeUndefined()
  })

  it('counts purchases for the active turn and clears both flags on a fresh turn', () => {
    const bought = recordBuyDev(recordBuyDev(recordRoll(initial, 7, {}), null), 'vp')
    expect(bought.turn?.devBought).toBe(2)
    for (const next of [endTurn(bought), setActivePlayer(bought, 'b')]) {
      expect(next.turn).not.toHaveProperty('devBought')
      expect(next.turn).not.toHaveProperty('robberMoved')
    }
  })

  it('round-trips the optional metadata and leaves legacy turns unchanged', () => {
    const game = recordBuyDev(recordRoll(initial, 7, {}), null)
    const parsed = parseGame(JSON.stringify(game))
    expect(parsed.ok && parsed.game.turn).toEqual(game.turn)
    const legacy = { ...game, turn: { playerId: 'aki', rolled: 7, devPlayed: false, progressPlayed: game.turn!.progressPlayed } }
    const old = parseGame(JSON.stringify(legacy))
    expect(old.ok && old.game.turn).toEqual(legacy.turn)
  })

  it.each([
    { robberMoved: 1 }, { robberMoved: null }, { devBought: -1 }, { devBought: 0.5 }, { devBought: '1' }, { unknown: true },
  ])('rejects invalid optional turn fields: %j', (fields) => {
    const game = recordRoll(initial, 7, {})
    expect(parseGame({ ...game, turn: { ...game.turn, ...fields } }).ok).toBe(false)
  })

  it('strikes a changed roll and the actions after it from the turn history', () => {
    const knight = recordPlayDev(initial, { kind: 'knight', hex: { q: 0, r: 1 }, victimId: null, stolen: null })
    const rolled = recordRoll(knight, 8, {})
    const bought = recordBuyDev(rolled, null)
    expect(currentTurnHistory([initial, knight, rolled, bought])).toEqual([initial, knight, rolled, bought])
    expect(currentTurnHistory([initial, knight, rolled, bought, knight])).toEqual([initial, knight])
    const ended = endTurn(bought)
    expect(currentTurnHistory([initial, rolled, bought, ended])).toEqual([ended])
  })
})
