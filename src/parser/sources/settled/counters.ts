import { emptyStats, type PlayerStats } from '../../../model/game'
import type { Rect, Rgb, RgbaImage } from '../../image'
import type { ParserPalette } from '../../palette'
import type { Registration } from '../../registration'
import type { ParseIssue, SourceStats } from '../types'
import type { DetectedPlayer, SettledRoster } from './chips'
import {
  DIGIT_TEMPLATES,
  ICON_TEMPLATES,
  PAREN_TEMPLATE,
  RIGHT_PAREN_TEMPLATE,
  type BinaryMask,
  type CounterIcon,
} from './templates'

interface LocatedMask extends BinaryMask {
  x: number
  y: number
}

interface ClassifiedMask extends LocatedMask {
  score: number
}

interface DigitMask extends ClassifiedMask {
  digit: number
}

interface IconMask extends ClassifiedMask {
  icon: CounterIcon
}

interface NumberMask {
  value: number
  score: number
  x: number
  y: number
  width: number
  height: number
}

// This radius includes antialiased dark and red counter ink without treating
// the chip fill as foreground.
const INK_DISTANCE = 96
// The digit floor plus a runner-up margin rejects ambiguous numerals. The icon
// floor rejects boon fragments while preserving detached counter shapes.
const DIGIT_SCORE = 0.65
const ICON_SCORE = 0.64
// Resampling erases distinguishing pixels, so degraded input needs stronger
// evidence, not a more permissive guess.
const DEGRADED_SCORE = 0.84

function normalizeMask(mask: BinaryMask, height: number): BinaryMask {
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

function maskScore(candidate: BinaryMask, template: BinaryMask): number {
  const normalized = normalizeMask(candidate, template.height)
  let intersection = 0
  for (const key of normalized.pixels) if (template.pixels.has(key)) intersection += 1
  const union = normalized.pixels.size + template.pixels.size - intersection
  return union === 0 ? 0 : intersection / union
}

function maskFromPixels(
  source: Set<string>,
  x: number,
  y: number,
  width: number,
  height: number,
): LocatedMask {
  const pixels = new Set<string>()
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      if (source.has(`${x + localX},${y + localY}`)) pixels.add(`${localX},${localY}`)
    }
  }
  return { x, y, width, height, pixels }
}

function connectedMasks(ink: Set<string>, width: number, height: number): LocatedMask[] {
  const unseen = new Set(ink)
  const components: LocatedMask[] = []
  while (unseen.size > 0) {
    const next = unseen.values().next()
    if (next.done) break
    const first = next.value
    const [startX, startY] = first.split(',').map(Number)
    const stack: [number, number][] = [[startX, startY]]
    unseen.delete(first)
    const pixels: [number, number][] = []
    let minX = startX
    let maxX = startX
    let minY = startY
    let maxY = startY
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      const [x, y] = current
      pixels.push(current)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
        const key = `${nextX},${nextY}`
        if (!unseen.delete(key)) continue
        stack.push([nextX, nextY])
      }
    }
    const componentPixels = new Set(pixels.map(([x, y]) => `${x - minX},${y - minY}`))
    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: componentPixels,
    })
  }
  return components
}

function combinedMasks(ink: Set<string>, components: LocatedMask[], glyphHeight: number): LocatedMask[] {
  const combined = [...components]
  for (let first = 0; first < components.length; first += 1) {
    for (let second = first + 1; second < components.length; second += 1) {
      const a = components[first]
      const b = components[second]
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const verticalGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
      if (overlap <= 0 || verticalGap > 0.22 * glyphHeight) continue
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      const width = Math.max(a.x + a.width, b.x + b.width) - x
      const height = Math.max(a.y + a.height, b.y + b.height) - y
      if (height <= 1.35 * glyphHeight) combined.push(maskFromPixels(ink, x, y, width, height))
    }
  }
  return combined
}

function classifyDigits(components: LocatedMask[], threshold: number): DigitMask[] {
  const matches: DigitMask[] = []
  for (const component of components) {
    if (component.height < 7 || component.width < 3 || component.width > 1.05 * component.height) continue
    const ranked: { digit: number; score: number }[] = []
    for (const [digit, template] of Object.entries(DIGIT_TEMPLATES)) {
      ranked.push({ digit: Number(digit), score: maskScore(component, template) })
    }
    ranked.sort((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best.score >= threshold && best.score - ranked[1].score >= 0.06) {
      matches.push({ ...component, digit: best.digit, score: best.score })
    }
  }
  return matches
}

function scanDigit(
  ink: Set<string>,
  startX: number,
  endX: number,
  centerY: number,
  glyphHeight: number,
  threshold: number,
): DigitMask | null {
  const scale = glyphHeight / 28
  const matches: DigitMask[] = []
  for (const [digit, template] of Object.entries(DIGIT_TEMPLATES)) {
    const width = Math.max(1, Math.round(template.width * scale))
    const height = Math.max(1, Math.round(template.height * scale))
    for (let y = Math.round(centerY - height / 2 - 0.12 * glyphHeight);
      y <= Math.round(centerY - height / 2 + 0.12 * glyphHeight); y += 1) {
      for (let x = Math.round(startX); x <= Math.round(endX); x += 1) {
        const candidate = maskFromPixels(ink, x, y, width, height)
        const score = maskScore(candidate, template)
        if (score >= threshold) matches.push({ ...candidate, digit: Number(digit), score })
      }
    }
  }
  const ranked = matches.sort((a, b) => b.score - a.score)
  if (!ranked[0]) return null
  const different = ranked.find((candidate) => candidate.digit !== ranked[0].digit)
  if (different && ranked[0].score - different.score < 0.06) return null
  return ranked[0]
}

function scanTemplate(
  ink: Set<string>,
  template: BinaryMask,
  startX: number,
  endX: number,
  centerY: number,
  glyphHeight: number,
): number {
  const scale = glyphHeight / 28
  const width = Math.max(1, Math.round(template.width * scale))
  const height = Math.max(1, Math.round(template.height * scale))
  let best = 0
  for (let y = Math.round(centerY - height / 2 - 0.12 * glyphHeight);
    y <= Math.round(centerY - height / 2 + 0.12 * glyphHeight); y += 1) {
    for (let x = Math.round(startX); x <= Math.round(endX); x += 1) {
      best = Math.max(best, maskScore(maskFromPixels(ink, x, y, width, height), template))
    }
  }
  return best
}

function classifyIcons(
  ink: Set<string>,
  components: LocatedMask[],
  glyphHeight: number,
  threshold: number,
): IconMask[] {
  const candidates = combinedMasks(ink, components, glyphHeight)
  for (const component of components) {

    // The bag lid is detached from its body. Its thin stroke anchors a full
    // glyph-sized window so the two pieces can still be classified together.
    if (component.height > 0.16 * glyphHeight || component.width < 0.42 * glyphHeight) continue
    const bagWidth = Math.max(1, Math.round(glyphHeight))
    const bagHeight = bagWidth
    const x = Math.max(0, Math.round(component.x + component.width / 2 - bagWidth / 2))
    candidates.push(maskFromPixels(ink, x, component.y, bagWidth, bagHeight))
  }
  const matches: IconMask[] = []
  for (const candidate of candidates) {
    if (candidate.height < 0.55 * glyphHeight || candidate.height > 1.6 * glyphHeight) continue
    let bestIcon: CounterIcon = 'trophy'
    let bestScore = 0
    for (const [icon, template] of Object.entries(ICON_TEMPLATES) as [CounterIcon, BinaryMask][]) {
      const score = maskScore(candidate, template)
      if (score > bestScore) {
        bestIcon = icon
        bestScore = score
      }
    }
    if (bestScore < threshold) continue
    const duplicate = matches.find((match) =>
      match.icon === bestIcon &&
      Math.hypot(
        match.x + match.width / 2 - candidate.x - candidate.width / 2,
        match.y + match.height / 2 - candidate.y - candidate.height / 2,
      ) < 0.45 * glyphHeight)
    if (!duplicate) matches.push({ ...candidate, icon: bestIcon, score: bestScore })
    else if (bestScore > duplicate.score) Object.assign(duplicate, candidate, { score: bestScore })
  }
  return matches
}

function groupDigits(digits: DigitMask[], glyphHeight: number): NumberMask[] {
  const remaining = [...digits].sort((a, b) => a.x - b.x)
  const groups: DigitMask[][] = []
  for (const digit of remaining) {
    const group = groups.find((candidate) => {
      const last = candidate.at(-1)
      if (!last) return false
      const gap = digit.x - last.x - last.width
      const baseline = Math.abs(digit.y + digit.height - last.y - last.height)
      return gap >= -0.05 * glyphHeight && gap <= 0.42 * glyphHeight && baseline <= 0.22 * glyphHeight
    })
    if (group) group.push(digit)
    else groups.push([digit])
  }
  return groups.map((group) => {
    const x = Math.min(...group.map((digit) => digit.x))
    const y = Math.min(...group.map((digit) => digit.y))
    const right = Math.max(...group.map((digit) => digit.x + digit.width))
    const bottom = Math.max(...group.map((digit) => digit.y + digit.height))
    return {
      value: Number(group.sort((a, b) => a.x - b.x).map((digit) => digit.digit).join('')),
      score: Math.min(...group.map((digit) => digit.score)),
      x,
      y,
      width: right - x,
      height: bottom - y,
    }
  })
}

// Binding uses the nearest plausible number to the right instead of rows. On
// reflowed chips the trophy total stacks while the bag counter interleaves
// horizontally, so loose vertical compatibility is required. Slight overlap
// allows touching ink, while the right and vertical caps exclude other counters.
function bindNumber(icon: IconMask, numbers: NumberMask[], glyphHeight: number): NumberMask | null {
  const candidates = numbers.filter((number) => {
    const gap = number.x - icon.x - icon.width
    const centerDelta = Math.abs(number.y + number.height / 2 - icon.y - icon.height / 2)
    return gap >= -0.25 * glyphHeight && gap <= 0.8 * glyphHeight && centerDelta <= 0.9 * glyphHeight
  })
  return candidates.sort((a, b) => {
    const distanceA = Math.hypot(a.x - icon.x - icon.width, a.y - icon.y)
    const distanceB = Math.hypot(b.x - icon.x - icon.width, b.y - icon.y)
    return distanceA - distanceB
  })[0] ?? null
}

function statIssue(playerId: string, field: keyof Pick<PlayerStats, 'handUnknown' | 'devCards' | 'knights' | 'vpCards'>, message: string): ParseIssue {
  return {
    stage: 'stats',
    severity: 'unreadable',
    message,
    ref: `${playerId}.${field}`,
  }
}

function chipInk(image: RgbaImage, palette: ParserPalette, rect: Rect): Set<string> {
  const ink = new Set<string>()
  const nearReference = (index: number, reference: Rgb): boolean => {
    const red = image.data[index] - reference[0]
    const green = image.data[index + 1] - reference[1]
    const blue = image.data[index + 2] - reference[2]
    return red * red + green * green + blue * blue <= INK_DISTANCE ** 2
  }
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const index = ((rect.y + y) * image.width + rect.x + x) * 4
      if (nearReference(index, palette.inkDark) || nearReference(index, palette.inkRed)) {
        ink.add(`${x},${y}`)
      }
    }
  }
  return ink
}

function parseChip(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
  entry: DetectedPlayer,
): { stats: PlayerStats; issues: ParseIssue[] } {
  const stats = emptyStats()
  const issues: ParseIssue[] = []
  const top = Math.max(entry.chipRect.y, entry.labelRect.y + entry.labelRect.height)
  const bottom = Math.min(
    entry.chipRect.y + entry.chipRect.height,
    Math.round(registration.bandTop - 0.2 * registration.size),
  )
  const rect = {
    x: entry.chipRect.x,
    y: top,
    width: entry.chipRect.width,
    height: Math.max(1, bottom - top),
  }
  const ink = chipInk(image, palette, rect)
  const components = connectedMasks(ink, rect.width, rect.height)
    .filter((component) => component.pixels.size >= Math.max(2, 0.0004 * registration.size ** 2))
  const glyphHeight = Math.max(12, 0.29 * registration.size)
  const degraded = registration.size < 75 || registration.softInput
  const digitThreshold = degraded ? DEGRADED_SCORE : DIGIT_SCORE
  const iconThreshold = degraded ? DEGRADED_SCORE : ICON_SCORE
  const digits = classifyDigits(components, digitThreshold)
  const numbers = groupDigits(digits, glyphHeight)
  const icons = classifyIcons(ink, components, glyphHeight, iconThreshold)

  const fields: [CounterIcon, keyof Pick<PlayerStats, 'handUnknown' | 'devCards' | 'knights'>][] = [
    ['bag', 'handUnknown'],
    ['scroll', 'devCards'],
    ['sword', 'knights'],
  ]
  for (const [iconName, field] of fields) {
    const icon = icons.filter((candidate) => candidate.icon === iconName)
      .sort((a, b) => b.score - a.score)[0]
    if (!icon) continue
    const number = bindNumber(icon, numbers, glyphHeight)
    if (!number) {
      issues.push(statIssue(entry.player.id, field, `Could not read ${field} for ${entry.player.name}`))
      continue
    }
    stats[field] = number.value
  }

  const trophy = icons.filter((candidate) => candidate.icon === 'trophy')
    .sort((a, b) => b.score - a.score)[0]
  const trophyNumber = trophy ? bindNumber(trophy, numbers, glyphHeight) : null
  const paren = components
    .map((component) => ({ ...component, score: maskScore(component, PAREN_TEMPLATE) }))
    .filter((component) => component.score >= (degraded ? DEGRADED_SCORE : DIGIT_SCORE))
    .sort((a, b) => b.score - a.score)[0]
  if (paren) {
    let parenthesized = numbers.filter((number) =>
      number.x >= paren.x + 0.5 * paren.width &&
      number.x <= paren.x + 3.2 * glyphHeight &&
      Math.abs(number.y + number.height / 2 - paren.y - paren.height / 2) <= 0.65 * glyphHeight)
      .sort((a, b) => a.x - b.x)[0]

    // On the You chip the bag overlaps the zero in (10), merging that zero
    // into the icon component. Rescan beside the isolated one to recover it.
    if (parenthesized?.value === 1) {
      const next = scanDigit(
        ink,
        parenthesized.x + parenthesized.width + 0.08 * glyphHeight,
        parenthesized.x + parenthesized.width + 0.42 * glyphHeight,
        parenthesized.y + parenthesized.height / 2,
        glyphHeight,
        digitThreshold,
      )
      if (next) {
        parenthesized = {
          value: 10 + next.digit,
          score: Math.min(parenthesized.score, next.score),
          x: parenthesized.x,
          y: Math.min(parenthesized.y, next.y),
          width: next.x + next.width - parenthesized.x,
          height: Math.max(parenthesized.y + parenthesized.height, next.y + next.height) -
            Math.min(parenthesized.y, next.y),
        }
      }
    }
    const rightParenScore = parenthesized
      ? scanTemplate(
          ink,
          RIGHT_PAREN_TEMPLATE,
          parenthesized.x + parenthesized.width,
          parenthesized.x + parenthesized.width + 0.55 * glyphHeight,
          paren.y + paren.height / 2,
          glyphHeight,
        )
      : 0
    if (!trophyNumber || !parenthesized || rightParenScore < digitThreshold) {
      issues.push(statIssue(entry.player.id, 'vpCards', `Could not read VP cards for ${entry.player.name}`))
    } else {
      const hidden = parenthesized.value - trophyNumber.value
      if (hidden < 0 || hidden > stats.devCards) {
        issues.push(statIssue(entry.player.id, 'vpCards', `VP card count failed validation for ${entry.player.name}`))
      } else {
        stats.vpCards = hidden
      }
    }
  }

  if (degraded) {
    for (const field of ['handUnknown', 'devCards', 'knights', 'vpCards'] as const) {
      if (stats[field] !== 0 || issues.some((issue) => issue.ref === `${entry.player.id}.${field}`)) continue
      issues.push(statIssue(entry.player.id, field, `Could not confirm ${field} on degraded input`))
    }
  }
  return { stats, issues }
}

export function readCounters(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
  roster: SettledRoster,
): SourceStats {
  const parsed = roster.players.map((entry) => [entry.player.id, parseChip(image, palette, registration, entry)] as const)
  return {
    stats: Object.fromEntries(parsed.map(([id, result]) => [id, result.stats])),
    issues: parsed.flatMap(([_id, result]) => result.issues),
  }
}
