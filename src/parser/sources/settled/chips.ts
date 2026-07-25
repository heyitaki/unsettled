import { PLAYER_PALETTE, type Player } from '../../../model/types'
import { colorDistanceSquared, pixel, type Rect, type Rgb, type RgbaImage } from '../../image'
import {
  classifyPlayerSeed,
  type ParserPalette,
  type PlayerSeed,
} from '../../palette'
import type { Registration } from '../../registration'
import type { SourceRoster } from '../types'
import { YOU_TEMPLATE } from './templates'

export interface DetectedPlayer {
  player: Player
  anchor: Rgb
  x: number
  y: number
  radius: number
  labelRect: Rect
  chipRect: Rect
}

export interface SettledRoster extends SourceRoster {
  players: DetectedPlayer[]
  templateScore: number
}

interface Dot {
  seed: PlayerSeed
  x: number
  y: number
  radius: number
  anchor: Rgb
}

const canonicalColor: Record<PlayerSeed, string> = {
  red: PLAYER_PALETTE.red,
  blue: PLAYER_PALETTE.blue,
  orange: PLAYER_PALETTE.orange,
  white: PLAYER_PALETTE.white,
  green: PLAYER_PALETTE.green,
}

export function labelRectFor(dot: Pick<Dot, 'x' | 'y' | 'radius'>): Rect {
  return {
    x: Math.round(dot.x + 1.8 * dot.radius),
    y: Math.round(dot.y - 1.8 * dot.radius),
    width: Math.round(9 * dot.radius),
    height: Math.round(3.6 * dot.radius),
  }
}

interface LabelMask {
  width: number
  height: number
  pixels: Set<string>
}

function labelMask(image: RgbaImage, palette: ParserPalette, rect: Rect): LabelMask | null {
  const pixels = new Set<string>()
  let minX = rect.width
  let maxX = -1
  let minY = rect.height
  let maxY = -1
  for (let y = 0; y <= rect.height; y += 1) {
    for (let x = 0; x <= rect.width; x += 1) {
      if (colorDistanceSquared(pixel(image, rect.x + x, rect.y + y), palette.inkDark) < 60 ** 2) {
        pixels.add(`${x},${y}`)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  const trimmed = new Set<string>()
  for (const key of pixels) {
    const [x, y] = key.split(',').map(Number)
    trimmed.add(`${x - minX},${y - minY}`)
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1, pixels: trimmed }
}

function normalizeMask(mask: LabelMask, height: number): LabelMask {
  if (mask.height === height) return mask
  const scale = height / mask.height
  const width = Math.max(1, Math.round(mask.width * scale))
  const pixels = new Set<string>()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(mask.width - 1, Math.floor(x / scale))
      const sourceY = Math.min(mask.height - 1, Math.floor(y / scale))
      if (mask.pixels.has(`${sourceX},${sourceY}`)) pixels.add(`${x},${y}`)
    }
  }
  return { width, height, pixels }
}

function templateScore(mask: LabelMask): number {
  const normalized = normalizeMask(mask, YOU_TEMPLATE.height)
  let intersection = 0
  for (const key of normalized.pixels) if (YOU_TEMPLATE.pixels.has(key)) intersection += 1
  return intersection / (normalized.pixels.size + YOU_TEMPLATE.pixels.size - intersection)
}

export function detectRoster(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
): SettledRoster {
  const seen = new Set<string>()
  const dots: Dot[] = []
  for (let y = 0; y < registration.bandTop; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const key = `${x},${y}`
      if (seen.has(key)) continue
      const seed = classifyPlayerSeed(pixel(image, x, y), palette)
      if (!seed) continue
      const stack: [number, number][] = [[x, y]]
      seen.add(key)
      let count = 0
      let sumX = 0
      let sumY = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let minX = image.width
      let maxX = 0
      let minY = image.height
      let maxY = 0
      while (stack.length > 0) {
        const current = stack.pop()
        if (!current) break
        const [currentX, currentY] = current
        const color = pixel(image, currentX, currentY)
        count += 1
        sumX += currentX
        sumY += currentY
        sumR += color[0]
        sumG += color[1]
        sumB += color[2]
        minX = Math.min(minX, currentX)
        maxX = Math.max(maxX, currentX)
        minY = Math.min(minY, currentY)
        maxY = Math.max(maxY, currentY)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nextX = currentX + dx
          const nextY = currentY + dy
          const nextKey = `${nextX},${nextY}`
          if (nextX < 0 || nextX >= image.width || nextY < 0 ||
            nextY >= registration.bandTop || seen.has(nextKey)) continue
          if (classifyPlayerSeed(pixel(image, nextX, nextY), palette) === seed) {
            seen.add(nextKey)
            stack.push([nextX, nextY])
          }
        }
      }
      const width = maxX - minX + 1
      const height = maxY - minY + 1
      if (count > 0.02 * registration.size ** 2 && count < 0.25 * registration.size ** 2 &&
        Math.abs(width / height - 1) < 0.35 && count / (width * height) > 0.6) {
        dots.push({
          seed,
          x: sumX / count,
          y: sumY / count,
          radius: (width + height) / 4,
          anchor: [sumR / count, sumG / count, sumB / count],
        })
      }
    }
  }
  const rows: { y: number; dots: Dot[] }[] = []
  for (const dot of dots.sort((a, b) => a.y - b.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - dot.y) < 0.2 * registration.size)
    if (row) {
      row.dots.push(dot)
      row.y = row.dots.reduce((sum, item) => sum + item.y, 0) / row.dots.length
    } else rows.push({ y: dot.y, dots: [dot] })
  }
  const chipRow = rows.filter((row) => row.dots.length >= 3).sort((a, b) => b.dots.length - a.dots.length)[0]
  if (!chipRow) return { players: [], mePlayerId: null, templateScore: 0 }
  const sortedDots = chipRow.dots.sort((a, b) => a.x - b.x)

  // These multipliers were measured from dot centers to the fixture card bounds.
  const dotRects = sortedDots.map((dot) => ({
    dot,
    x: Math.round(dot.x - 3.4 * dot.radius),
    y: Math.round(dot.y - 3.4 * dot.radius),
    width: Math.round(19.6 * dot.radius),
    height: Math.max(1, Math.round(registration.bandTop - dot.y + 1.6 * dot.radius)),
  }))

  // Overlapping dot-derived bounds share their midpoint so ink cannot cross cards.
  const players = dotRects.map((entry, index): DetectedPlayer => {
    const { dot } = entry
    const previous = dotRects[index - 1]
    const next = dotRects[index + 1]
    const left = previous
      ? Math.max(entry.x, Math.round((previous.x + previous.width + entry.x) / 2))
      : entry.x
    const right = next
      ? Math.min(entry.x + entry.width, Math.round((entry.x + entry.width + next.x) / 2))
      : entry.x + entry.width
    const id = `p${index + 1}`
    return {
      player: { id, name: `P${index + 1}`, color: canonicalColor[dot.seed] },
      anchor: dot.anchor,
      x: dot.x,
      y: dot.y,
      radius: dot.radius,
      labelRect: labelRectFor(dot),
      chipRect: {
        x: left,
        y: entry.y,
        width: Math.max(1, right - left),
        height: entry.height,
      },
    }
  })
  let bestScore = 0
  let mePlayerId: string | null = null
  for (const player of players) {
    const mask = labelMask(image, palette, player.labelRect)
    if (!mask) continue
    const score = templateScore(mask)
    if (score > bestScore) {
      bestScore = score
      mePlayerId = player.player.id
    }
  }
  return { players, mePlayerId: bestScore >= 0.7 ? mePlayerId : null, templateScore: bestScore }
}
