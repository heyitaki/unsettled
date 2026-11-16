import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, removePlayer, renamePlayer } from '../board'
import { mergeScreenshot, newGame, withBoard, type Game, type ScreenshotRead } from '../game'
import { positionOf } from '../history'
import { gameSignature, isFreshGame, parseGame, serializeGame } from '../serialization'
import { setActivePlayer } from '../turn'

const read: ScreenshotRead = {
  roster: true, order: false, picks: false,
  hands: ['aki'], unorderedPicks: ['aki'], points: { aki: 2 }, knights: [],
}
const base = () => newGame(createBoard('standard4'))

describe('pending import persistence', () => {
  it('round trips an open review without losing other optional fields or aliasing the input', () => {
    const game: Game = { ...setActivePlayer(base(), 'aki'),
      awards: { longestRoad: null, largestArmy: null },
      devHand: { playerId: 'aki', playable: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
        bought: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } },
      pendingImport: structuredClone(read),
    }
    expect(parseGame(serializeGame(game))).toEqual({ ok: true, game })
    const parsed = parseGame(game)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.game).toEqual(game)
    expect(parsed.game.pendingImport).not.toBe(game.pendingImport)
    for (const key of ['hands', 'unorderedPicks', 'points', 'knights'] as const) {
      expect(parsed.game.pendingImport?.[key]).not.toBe(game.pendingImport?.[key])
    }
    expect(positionOf(game)).not.toHaveProperty('pendingImport')
    expect(game.history?.start).not.toHaveProperty('pendingImport')
  })

  it('rejects missing, extra, malformed or out-of-roster read fields', () => {
    const invalid: unknown[] = [null, undefined, [], {}, { ...read, extra: true }]
    for (const key of Object.keys(read)) {
      const missing: Record<string, unknown> = { ...read }
      delete missing[key]
      invalid.push(missing)
    }
    for (const key of ['roster', 'order', 'picks']) {
      for (const value of [0, 'true', null]) invalid.push({ ...read, [key]: value })
    }
    for (const key of ['hands', 'unorderedPicks', 'knights']) {
      for (const value of [null, {}, 'aki', [1], ['ghost'], ['toString']]) invalid.push({ ...read, [key]: value })
    }
    for (const points of [null, [], 2, { aki: -1 }, { aki: 1.5 }, { aki: '2' }, { aki: Infinity }, { ghost: 2 }]) {
      invalid.push({ ...read, points })
    }
    for (const pendingImport of invalid) {
      expect(parseGame({ ...base(), pendingImport }), JSON.stringify(pendingImport)).toEqual({ ok: false, errors: ['Invalid pending import'] })
    }
  })

  it('includes the review in signatures and keeps it out of the fresh-game omission', () => {
    const game = base()
    const pending = { ...game, pendingImport: read }
    expect(isFreshGame(game)).toBe(true)
    expect(isFreshGame(pending)).toBe(false)
    expect(gameSignature(pending)).not.toBe(gameSignature(game))
  })

  it('keeps questions through edits and filters departing players so the game stays loadable', () => {
    const game: Game = { ...newGame(addPlayer(base().board, { id: 'b', name: 'Bee', color: '#3063ba' })),
      pendingImport: { ...read, hands: ['aki', 'b'], unorderedPicks: ['aki', 'b'], points: { aki: 2, b: 2 }, knights: ['b'] },
    }
    expect(withBoard(game, game.board)).toBe(game)
    const renamed = withBoard(game, renamePlayer(game.board, 'b', 'Bea'))
    expect(renamed.pendingImport).toEqual(game.pendingImport)
    const removed = withBoard(game, removePlayer(game.board, 'b'))
    expect(removed.pendingImport).toEqual(read)
    expect(parseGame(serializeGame(removed))).toEqual({ ok: true, game: removed })
    expect(game.pendingImport?.knights).toEqual(['b'])
  })

  it('keeps the saved review when merging, leaving the caller to replace it', () => {
    const saved = { ...base(), pendingImport: read }
    const shot = { ...base(), pendingImport: { ...read, order: true } }
    expect(mergeScreenshot(saved, shot, read).pendingImport).toEqual(read)
  })
})
