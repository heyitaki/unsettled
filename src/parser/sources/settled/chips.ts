import { PLAYER_PALETTE, type Player } from '../../../model/types'
import { labelComponents } from '../../components'
import { colorDistanceSquared, pixel, type Rect, type Rgb, type RgbaImage } from '../../image'
import {
  classifyPlayerSeed,
  type ParserPalette,
  type PlayerSeed,
} from '../../palette'
import type { Registration } from '../../registration'
import { maskScore, YOU_TEMPLATE, type BinaryMask } from './templates'

export interface DetectedPlayer {
  player: Player
  anchor: Rgb
  x: number
  y: number
  radius: number
  labelRect: Rect
  chipRect: Rect
}

export interface SettledRoster {
  players: DetectedPlayer[]
  mePlayerId: string | null
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

function labelMask(image: RgbaImage, palette: ParserPalette, rect: Rect): BinaryMask | null {
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

export function detectRoster(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
): SettledRoster {
  const dots: Dot[] = []
  // The sums belong to the component being yielded: consume the generator lazily, never spread it.
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (const component of labelComponents(
    { minX: 0, maxX: image.width - 1, minY: 0, maxY: registration.bandTop - 1 },
    (x, y) => classifyPlayerSeed(pixel(image, x, y), palette),
    {
      visit(x, y) {
        const color = pixel(image, x, y)
        sumR += color[0]
        sumG += color[1]
        sumB += color[2]
      },
    },
  )) {
    const { label: seed, area: count, x, y, minX, maxX, minY, maxY } = component
    const width = maxX - minX + 1
    const height = maxY - minY + 1
    if (count > 0.02 * registration.size ** 2 && count < 0.25 * registration.size ** 2 &&
      Math.abs(width / height - 1) < 0.35 && count / (width * height) > 0.6) {
      dots.push({
        seed,
        x,
        y,
        radius: (width + height) / 4,
        anchor: [sumR / count, sumG / count, sumB / count],
      })
    }
    sumR = 0
    sumG = 0
    sumB = 0
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
  if (!chipRow) return { players: [], mePlayerId: null }
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
    return { players: [], mePlayerId: null }
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
    const score = maskScore(mask, YOU_TEMPLATE)
    if (score > bestScore) {
      bestScore = score
      mePlayerId = player.player.id
    }
  }
  return { players, mePlayerId: bestScore >= 0.7 ? mePlayerId : null }
}
