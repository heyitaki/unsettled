import { describe, expect, it } from 'vitest'
import type { PlayerStats } from '../../model/game'
import type { Rect, RgbaImage } from '../image'
import type { ParserPalette } from '../palette'
import type { Registration } from '../registration'
import {
  ScreenshotSource,
  type SourceDetection,
  type SourceParse,
  type SourceRoster,
} from '../sources/types'
import { createSourceRegistry } from '../sources/registry'

const image: RgbaImage = {
  width: 64,
  height: 64,
  data: new Uint8ClampedArray(64 * 64 * 4),
}

class FakeSource extends ScreenshotSource {
  readonly id: string
  private readonly confidence: number | null
  private readonly marker: string

  constructor(id: string, confidence: number | null, marker: string) {
    super()
    this.id = id
    this.confidence = confidence
    this.marker = marker
  }

  detect(_image: RgbaImage): SourceDetection | null {
    return this.confidence === null ? null : { confidence: this.confidence }
  }

  override parse(_image: RgbaImage): SourceParse {
    return { ok: false, error: this.marker }
  }

  palette(_image: RgbaImage): ParserPalette | null {
    throw new Error('unused')
  }

  readRoster(_image: RgbaImage, _palette: ParserPalette, _registration: Registration): SourceRoster {
    throw new Error('unused')
  }

  readStats(
    _image: RgbaImage,
    _palette: ParserPalette,
    _registration: Registration,
    _roster: SourceRoster,
  ): { stats: Record<string, PlayerStats>; issues: [] } {
    throw new Error('unused')
  }

  nameRects(_roster: SourceRoster): { playerId: string; rect: Rect }[] {
    throw new Error('unused')
  }
}

describe('screenshot source registry', () => {
  it('runs the highest-confidence accepting source', () => {
    const registry = createSourceRegistry([
      new FakeSource('lower', 0.4, 'lower parsed'),
      new FakeSource('higher', 0.9, 'higher parsed'),
      new FakeSource('declines', null, 'declining source parsed'),
    ])
    expect(registry.parse(image)).toEqual({ ok: false, error: 'higher parsed' })
  })

  it('declines cleanly when no source accepts the image', () => {
    const registry = createSourceRegistry([
      new FakeSource('first', null, 'first parsed'),
      new FakeSource('second', null, 'second parsed'),
    ])
    expect(registry.parse(image)).toEqual({ ok: false, error: 'not a recognizable board' })
  })
})
