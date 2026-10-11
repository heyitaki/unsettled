import { labelPixelSet } from '../../components'
import { nearColor, pixel, type Rect, type RgbaImage } from '../../image'
import type { ParserPalette } from '../../palette'
import { DIGIT_TEMPLATES, maskScore } from './templates'

export function readPillCounter(
  image: RgbaImage,
  palette: ParserPalette,
  pill: Rect,
  start: number,
  direction: 1 | -1,
  degraded: boolean,
): number | null {
  const isInk = (x: number, y: number) => nearColor(pixel(image, x, y), palette.counterInk, 35)
  const x = Math.round(start)
  const y = Math.round(pill.y + 0.27 * pill.height)
  const height = Math.round(0.48 * pill.height)
  let width = 0
  let seenInk = false
  let gap = 0

  // The wide gap before an icon bounds the counter without clipping a second digit.
  while (width < Math.round(0.95 * pill.height)) {
    let ink = false
    for (let dy = 0; dy < height; dy += 1) {
      if (isInk(x + direction * width, y + dy)) ink = true
    }
    seenInk ||= ink
    gap = ink ? 0 : gap + 1
    width += 1
    if (seenInk && gap >= 0.12 * pill.height) break
  }
  const rect = { x: direction === 1 ? x : x - width + 1, y, width, height }
  const ink = new Set<string>()
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      if (!isInk(rect.x + x, rect.y + y)) continue
      if (x === 0 || y === 0 || x === rect.width - 1 || y === rect.height - 1) return null
      ink.add(`${x},${y}`)
    }
  }
  const glyphs = labelPixelSet(ink).sort((a, b) => a.minX - b.minX)
  if (glyphs.length < 1 || glyphs.length > 2) return null
  const digits: number[] = []
  for (const [index, glyph] of glyphs.entries()) {
    const width = glyph.maxX - glyph.minX + 1
    const height = glyph.maxY - glyph.minY + 1
    if (height < 7 || width < 3) return null
    const previous = glyphs[index - 1]
    if (previous && (glyph.minX <= previous.maxX || glyph.minX - previous.maxX - 1 > 0.42 * height ||
      Math.abs(glyph.maxY - previous.maxY) > 0.22 * height)) return null
    const mask = {
      width,
      height,
      pixels: new Set(glyph.points.map(([x, y]) => `${x - glyph.minX},${y - glyph.minY}`)),
    }
    const ranked = Object.entries(DIGIT_TEMPLATES)
      .map(([digit, template]) => ({ digit: Number(digit), score: maskScore(mask, template) }))
      .sort((a, b) => b.score - a.score)

    // Resampling can erase the strokes that distinguish otherwise similar digits.
    if (ranked[0].score < (degraded ? 0.84 : 0.65) || ranked[0].score - ranked[1].score < 0.06) return null
    digits.push(ranked[0].digit)
  }
  return Number(digits.join(''))
}
