// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { parseGame, serializeGame } from '../../model/serialization'
import { loadMap, saveMap } from '../../persistence/localStorage'
import { parseScreenshot } from '../index'
import { withCounterTen } from './pillPixels'

describe('parsed game persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round trips non-zero parsed stats through JSON and a saved map', () => {
    const parsed = parseScreenshot(withCounterTen('hand'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.game.stats.p1.handUnknown).toBe(10)

    expect(parseGame(serializeGame(parsed.game))).toEqual({ ok: true, game: parsed.game })
    const saved = saveMap('parsed', parsed.game)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(loadMap(saved.id)).toEqual({ ok: true, game: parsed.game })
  })
})
