import type { RgbaImage } from '../image'
import { ScreenshotSource, type SourceParse } from './types'
import { SettledSource } from './settled'

export interface SourceRegistry {
  parse(image: RgbaImage): SourceParse
}

export function createSourceRegistry(sources: readonly ScreenshotSource[]): SourceRegistry {
  return {
    parse(image: RgbaImage): SourceParse {
      const detected = sources.flatMap((source, index) => {
        try {
          const detection = source.detect(image)
          if (!detection || !Number.isFinite(detection.confidence) ||
            detection.confidence < 0 || detection.confidence > 1) return []
          return [{ source, index, confidence: detection.confidence }]
        } catch {
          return []
        }
      })
      const winner = detected.sort((a, b) => b.confidence - a.confidence || a.index - b.index)[0]
      return winner ? winner.source.parse(image) : { ok: false, error: 'not a recognizable board' }
    },
  }
}

export const DEFAULT_SOURCES: readonly ScreenshotSource[] = [
  new SettledSource(),
]
