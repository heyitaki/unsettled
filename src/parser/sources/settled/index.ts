import type { Rect, RgbaImage } from '../../image'
import type { ParserPalette } from '../../palette'
import type { Registration } from '../../registration'
import { ScreenshotSource, type SourceDetection, type SourceStats } from '../types'
import { detectRoster, type SettledRoster } from './chips'
import { readCounters } from './counters'
import { choosePalette, matchPalette } from './palette'

export class SettledSource extends ScreenshotSource<SettledRoster> {
  readonly id = 'settled-ios'

  detect(image: RgbaImage): SourceDetection | null {
    const match = matchPalette(image)
    return match ? { confidence: match.confidence } : null
  }

  palette(image: RgbaImage): ParserPalette | null {
    return choosePalette(image)
  }

  readRoster(image: RgbaImage, palette: ParserPalette, registration: Registration): SettledRoster {
    return detectRoster(image, palette, registration)
  }

  readStats(
    image: RgbaImage,
    palette: ParserPalette,
    registration: Registration,
    roster: SettledRoster,
  ): SourceStats {
    return readCounters(image, palette, registration, roster)
  }

  nameRects(roster: SettledRoster): { playerId: string; rect: Rect }[] {
    return roster.players.map((entry) => ({ playerId: entry.player.id, rect: entry.labelRect }))
  }
}

export default SettledSource
