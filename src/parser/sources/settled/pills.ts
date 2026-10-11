import { PLAYER_PALETTE, type Player } from '../../../model/types'
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
      vp: readPillCounter(image, palette, pill, pill.x + 2 * contentHeight, 1, degraded),
      hand: readPillCounter(image, palette, pill, pill.x + pill.width - 0.15 * pill.height, -1, degraded),
    })
    if (pill.highlighted) highlighted.push(id)
  }
  return { players, turnPlayerId: highlighted.length === 1 ? highlighted[0] : null, issues }
}
