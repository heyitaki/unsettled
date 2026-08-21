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

// A row of cards draws one dot size, so this rejects blobs that merely sit in
// line with each other.
const DOT_RADIUS_AGREEMENT = 0.25

function medianRadius(dots: Dot[]): number {
  const radii = dots.map((dot) => dot.radius).sort((a, b) => a - b)
  return radii[Math.floor((radii.length - 1) / 2)]
}

function radiiAgree(dots: Dot[]): boolean {
  const radii = dots.map((dot) => dot.radius)
  const largest = Math.max(...radii)
  return largest - Math.min(...radii) <= DOT_RADIUS_AGREEMENT * largest
}

function labelRectFor(dot: Pick<Dot, 'x' | 'y' | 'radius'>): Rect {
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
  // Two players is a legal roster, so the dot count can no longer separate cards
  // from header decoration. Three facts about cards replace it.
  // One card per player, so a colour cannot repeat: the dot nearest the row's
  // median size wins, which drops a stray badge whichever side of the real dot
  // its size falls.
  const oneDotPerSeed = rows.map((row) => {
    const middle = medianRadius(row.dots)
    const bySeed = new Map<PlayerSeed, Dot>()
    for (const dot of row.dots) {
      const held = bySeed.get(dot.seed)
      if (!held || Math.abs(dot.radius - middle) < Math.abs(held.radius - middle)) bySeed.set(dot.seed, dot)
    }
    return { y: row.y, dots: [...bySeed.values()] }
  })
  // Every card draws the same dot, so radii that disagree mean decoration.
  const cardRows = oneDotPerSeed.filter((row) => row.dots.length >= 2 && radiiAgree(row.dots))
  // The roster sits directly above the board, so the lowest surviving row is it.
  const chipRow = cardRows.sort((a, b) => b.y - a.y)[0]
  if (!chipRow) return { players: [], mePlayerId: null, templateScore: 0 }
  const sortedDots = chipRow.dots.sort((a, b) => a.x - b.x)

  // Cards tile the row, so the pitch sets their width; a fixed multiple of the
  // radius clips the rightmost counter on every roster wider than the one it was
  // measured on. Minimum gap, not median or mean: a seat whose colour the palette
  // does not know merges two pitches into one, and that is the only distortion
  // this row can carry once a colour cannot repeat, so the short gaps are the
  // honest ones. Erring narrow also fails loudly, since a truncated card reports
  // "could not read", where erring wide fails silently with a card reading its
  // neighbour's counters as its own.
  const pitch = Math.min(...sortedDots.slice(1).map((dot, index) => dot.x - sortedDots[index].x))
  // Cards narrower than the dots they carry are not cards. Reporting no roster
  // hands the caller its synthesized-from-pieces path, which warns, rather than
  // fabricating slits that read every counter as zero in silence.
  if (pitch <= Math.max(...sortedDots.map((dot) => dot.radius))) {
    return { players: [], mePlayerId: null, templateScore: 0 }
  }

  // Multipliers measured from dot centers to the fixture card bounds. Clamped at
  // the left edge because chipInk indexes the row arithmetically, so a negative
  // x would wrap onto the previous scanline.
  const cards = sortedDots.map((dot) => ({
    dot,
    x: Math.max(0, Math.round(dot.x - 3.4 * dot.radius)),
    y: Math.round(dot.y - 3.4 * dot.radius),
    // The gutter between cards is one radius.
    width: Math.round(pitch - dot.radius),
    height: Math.max(1, Math.round(registration.bandTop - dot.y + 1.6 * dot.radius)),
  }))

  // A card stops at the next card's left edge, and at the image edge when it is
  // the last, so ink cannot cross cards even where the pitch is overestimated.
  const players = cards.map((entry, index): DetectedPlayer => {
    const { dot } = entry
    const next = cards[index + 1]
    const right = Math.min(next ? next.x : image.width, entry.x + entry.width)
    const id = `p${index + 1}`
    return {
      player: { id, name: `P${index + 1}`, color: PLAYER_PALETTE[dot.seed] },
      anchor: dot.anchor,
      x: dot.x,
      y: dot.y,
      radius: dot.radius,
      labelRect: labelRectFor(dot),
      chipRect: {
        x: entry.x,
        y: entry.y,
        width: Math.max(1, right - entry.x),
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
