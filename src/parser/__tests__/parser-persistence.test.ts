// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseGame, serializeGame } from '../../model/serialization'
import { loadMap, saveMap } from '../../persistence/localStorage'
import { parseBoardImage, type RgbaImage } from '../index'

function image(path: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(path, import.meta.url))))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

describe('parsed game persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round trips non-zero parsed stats through JSON and a saved map', () => {
    const parsed = parseBoardImage(image('../../../fixtures/board-endgame-pieces.png'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parseGame(serializeGame(parsed.game))).toEqual({ ok: true, game: parsed.game })
    const saved = saveMap('parsed', parsed.game, true)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(loadMap(saved.id)).toEqual({ ok: true, game: parsed.game })
  })
})
