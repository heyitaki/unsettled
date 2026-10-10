import { describe, expect, it } from 'vitest'
import { emptyStats } from '../../model/game'
import { parseScreenshot } from '../index'
import { nearColor, pixel } from '../image'
import { registerBoard } from '../registration'
import { detectRoster } from '../sources/settled/pills'
import { choosePalette } from '../sources/settled/palette'
import { copy, load, nearestScale, paint, withCounterTen } from './pillPixels'

describe('Settled pill counters', () => {
  it.each(['settled-2p-first-pick', 'settled-3p-pick-cards', 'settled-5p-draft-start'])('reads %s without inventing hidden stats', (name) => {
    const result = parseScreenshot(load(name))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const stats of Object.values(result.game.stats)) expect(stats).toEqual(emptyStats())
    expect(result.issues.filter((issue) => issue.stage === 'stats')).toEqual([])
  })

  it('warns with the player name when pill VP disagrees with the pieces', () => {
    const image = load()
    // White has one settlement. Copy Brown's zero over White's VP one.
    copy(image, { x: 841, y: 347, width: 28, height: 35 }, 514, 347)
    const palette = choosePalette(image)!
    const roster = detectRoster(image, palette, registerBoard(image, palette)!)
    expect(roster.players[0].vp).toBe(0)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.filter((issue) => issue.stage === 'stats')).toEqual([
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('White') }),
    ])
  })

  it('stores the hand counter independently of VP', () => {
    const image = load()
    paint(image, { x: 592, y: 347, width: 28, height: 35 }, [248, 243, 225])
    copy(image, { x: 519, y: 347, width: 25, height: 35 }, 597, 347)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.stats.p1.handUnknown).toBe(1)
  })

  it.each(['hand', 'vp'] as const)('reads a pixel-copied two-digit %s counter completely', (field) => {
    const image = withCounterTen(field)
    const palette = choosePalette(image)!
    const roster = detectRoster(image, palette, registerBoard(image, palette)!)
    expect(roster.players[0][field]).toBe(10)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.filter((issue) => issue.stage === 'stats' && issue.severity === 'unreadable')).toEqual([])
    if (field === 'hand') expect(result.game.stats.p1.handUnknown).toBe(10)
  })

  it('reports an unreadable counter when ink touches its read-box edge', () => {
    const image = load()
    paint(image, { x: 518, y: 350, width: 1, height: 15 }, [117, 94, 66])
    const palette = choosePalette(image)!
    expect(detectRoster(image, palette, registerBoard(image, palette)!).players[0].vp).toBeNull()
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'stats', severity: 'unreadable', message: 'Could not read victory points for White' }))
  })

  it('rejects a whole two-digit counter when one glyph is unreadable', () => {
    const image = withCounterTen('hand')
    paint(image, { x: 611, y: 351, width: 18, height: 26 }, [117, 94, 66])
    const palette = choosePalette(image)!
    expect(detectRoster(image, palette, registerBoard(image, palette)!).players[0].hand).toBeNull()
  })

  it.each(['hand', 'vp'] as const)('never guesses a wrong %s counter on a half-scale pill', (field) => {
    const original = withCounterTen(field)
    const image = nearestScale(original)
    const palette = choosePalette(image)!
    const roster = detectRoster(image, palette, registerBoard(image, palette)!)
    expect(roster.players).toHaveLength(2)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const entry of roster.players) {
      for (const counter of ['vp', 'hand'] as const) {
        const expected = entry.player.id === 'p1' ? counter === field ? 10 : counter === 'vp' ? 1 : 0 : 0
        expect([null, expected]).toContain(entry[counter])
        if (entry[counter] === null) expect(result.issues).toContainEqual(expect.objectContaining({
          stage: 'stats', severity: 'unreadable', message: `Could not read ${counter === 'vp' ? 'victory points' : 'hand cards'} for ${entry.player.name}`,
        }))
      }
    }
  })

  it('leaves the seat unclaimed when the pill highlight is painted over', () => {
    const image = load()
    for (let y = 300; y < 440; y += 1) {
      for (let x = 655; x < 994; x += 1) {
        const color = pixel(image, x, y)
        if (nearColor(color, [171, 81, 52], 20)) paint(image, { x, y, width: 1, height: 1 }, [213, 195, 154])
        else if (nearColor(color, [229, 215, 178], 10)) paint(image, { x, y, width: 1, height: 1 }, [248, 243, 225])
      }
    }
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.board.players).toHaveLength(2)
    expect(result.game.board.mePlayerId).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'roster', message: expect.stringContaining('player to move') }))
  })
})
