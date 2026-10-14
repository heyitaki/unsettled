import type { TileKind } from '../../../model/types'
import { nearColor, type Rgb, type RgbaImage } from '../../image'
import { playerFromSeed } from '../../palette'

// ponytail: paid seat colours are missed until fixtures support their detection.
export const SEATS = ['red', 'blue', 'orange', 'green'] as const
export type Seat = typeof SEATS[number]

export const seatPlayer = (seat: Seat) => playerFromSeed(`s-${seat}`, seat)

const SEA_P3: Rgb = [45, 100, 160]
const SEA_SRGB: Rgb = [11, 102, 165]
const TOKEN_CREAM: Rgb = [233, 232, 228]

export function isColonistScreen(image: RgbaImage): boolean {
  if (image.width <= 0 || image.height <= 0 || image.data.length < image.width * image.height * 4) return false
  let sea = 0
  let samples = 0
  for (let y = 0; y < image.height; y += 16) {
    for (let x = 0; x < image.width; x += 16) {
      const index = (y * image.width + x) * 4
      const color: Rgb = [image.data[index], image.data[index + 1], image.data[index + 2]]
      if (isSea(color)) sea += 1
      samples += 1
    }
  }
  return sea > 0.1 * samples
}

export function isSea(color: Rgb): boolean {
  return nearColor(color, SEA_P3, 6) || nearColor(color, SEA_SRGB, 6)
}

export function isTokenCream(color: Rgb): boolean {
  return nearColor(color, TOKEN_CREAM, 9)
}

export function classifyTerrain([r, g, b]: Rgb): TileKind | null {
  // The hue gaps survive both the gradients and Display P3 to sRGB conversion.
  if (g < 55) return null
  if (r / g < 0.72 && b / g < 0.8) return 'wood'
  if (r / g >= 0.72 && r / g < 1.04 && b / g < 0.55) return 'sheep'
  if (r / g > 1.07 && r / g < 1.5 && b / g < 0.6) return 'wheat'
  if (r / g > 1.5 && b / g < 0.85) return 'brick'
  if (g < 220 && Math.max(r, g, b) - Math.min(r, g, b) < 0.12 * g) return 'ore'
  if (r / g >= 1 && r / g < 1.18 && b / g > 0.6 && b / g < 0.9) return 'desert'
  return null
}
