import { PLAYER_PALETTE, type Player } from '../../../model/types'
import { PRINT_CUTOFF, printDistance } from '../../../model/people'
import { labelComponents } from '../../components'
import { nearColor, pixel, type Rect, type Rgb, type RgbaImage } from '../../image'
import { classifyPlayerSeed, playerFromSeed, type ParserPalette } from '../../palette'
import type { Registration } from '../../registration'
import type { ParseIssue } from '../types'
import { readPillCounter } from './counters'

interface DetectedPlayer {
  player: Player
  anchor: Rgb
  vp: number | null
  hand: number | null
  avatar?: string
}

interface SettledRoster {
  players: DetectedPlayer[]
  turnPlayerId: string | null
  issues: ParseIssue[]
}

export function detectRoster(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
): SettledRoster {
  const pills: (Rect & { highlighted: boolean })[] = []
  for (const component of labelComponents(
    { minX: 0, maxX: image.width - 1, minY: 0, maxY: registration.bandTop - 1 },
    (x, y) => {
      const color = pixel(image, x, y)
      if (nearColor(color, palette.pillHighlight, 12)) return 'turn'
      return nearColor(color, palette.chipCream, 12) ? 'plain' : null
    },
    { step: 2 },
  )) {
    const width = component.maxX - component.minX + 1
    const height = component.maxY - component.minY + 1
    const aspect = width / height
    if (height >= 20 && aspect > 2.8 && aspect < 4.8 && component.area * 4 > 0.55 * width * height) {
      pills.push({ x: component.minX, y: component.minY, width, height, highlighted: component.label === 'turn' })
    }
  }
  pills.sort((a, b) => Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2 ? a.x - b.x : a.y - b.y)
  const players: DetectedPlayer[] = []
  const highlighted: string[] = []
  const issues: ParseIssue[] = []
  for (const [index, pill] of pills.entries()) {

    // Pill width varies, so anchor the dot and VP on the left and the hand on the right using fill height.
    const anchor = pixel(image, pill.x + 0.3 * pill.height, pill.y + pill.height / 2)
    const seed = classifyPlayerSeed(anchor, palette)
    if (!seed || players.some((entry) => entry.player.color === PLAYER_PALETTE[seed])) {
      issues.push({
        stage: 'roster',
        severity: 'warning',
        message: `Skipped player pill ${index + 1}: ${seed ? 'duplicate colour' : 'colour could not be identified'}`,
      })
      continue
    }
    const id = `p${players.length + 1}`

    // The thicker highlighted border reduces the detected fill height without shrinking its contents.
    const contentHeight = pill.height * (pill.highlighted ? 83 / 77 : 1)
    const degraded = registration.softInput || pill.height < 60
    players.push({
      player: playerFromSeed(id, seed),
      anchor,
      avatar: fingerprint(image, pill, contentHeight),
      vp: readPillCounter(image, palette, pill, pill.x + 2 * contentHeight, 1, degraded),
      hand: readPillCounter(image, palette, pill, pill.x + pill.width - 0.15 * pill.height, -1, degraded),
    })
    if (pill.highlighted) highlighted.push(id)
  }
  const shared = players.filter(({ avatar }, index) => avatar !== undefined && players.some((other, at) =>
    at !== index && other.avatar !== undefined && printDistance(avatar, other.avatar) < PRINT_CUTOFF))
  for (const entry of shared) delete entry.avatar
  return { players, turnPlayerId: highlighted.length === 1 ? highlighted[0] : null, issues }
}

function fingerprint(image: RgbaImage, pill: Rect, contentHeight: number): string | undefined {
  const h = contentHeight
  const y = pill.y + pill.height / 2
  const fill = pixel(image, pill.x + 0.6 * h, pill.y + 0.15 * h)
  let first: number | undefined
  let last = 0
  for (let x = Math.ceil(pill.x + 0.55 * h); x <= pill.x + 1.5 * h; x += 1) {
    if (!nearColor(pixel(image, x, y), fill, 20)) {
      first ??= x
      last = x
    }
  }
  if (first === undefined || last === first) return undefined
  const center = (first + last) / 2
  const side = 1.3 * (last - first) / 2
  const values: number[] = []
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const sum = [0, 0, 0]
      let count = 0
      for (let cy = Math.ceil(y - side / 2 + row * side / 8); cy < y - side / 2 + (row + 1) * side / 8; cy += 1) {
        for (let cx = Math.ceil(center - side / 2 + col * side / 8); cx < center - side / 2 + (col + 1) * side / 8; cx += 1) {
          const color = pixel(image, cx, cy)
          for (let channel = 0; channel < 3; channel += 1) sum[channel] += color[channel]
          count += 1
        }
      }
      if (count === 0) return undefined
      values.push(...sum.map((total) => Math.round(total / count)))
    }
  }

  // Measure spatial variation per channel so a solid coloured placeholder is blank too.
  const means = [0, 1, 2].map((channel) => values.filter((_, index) => index % 3 === channel).reduce((sum, value) => sum + value, 0) / 64)
  const variance = values.reduce((sum, value, index) => sum + (value - means[index % 3]) ** 2, 0) / values.length
  if (variance < 4 ** 2) return undefined
  return values.map((value) => value.toString(16).padStart(2, '0')).join('')
}
