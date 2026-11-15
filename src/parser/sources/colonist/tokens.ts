import { isRedToken } from '../../../model/board'
import { enclosedHoles, labelComponents } from '../../components'
import { nearColor, pixel, type Rgb, type RgbaImage } from '../../image'
import type { TokenSquare } from './registration'

const ROBBER_COLOR: Rgb = [187, 187, 187]

export function readNumber(image: RgbaImage, square: TokenSquare): { number: number | null; colorMismatch: boolean } {
  const unreadable = { number: null, colorMismatch: false }
  const side = square.maxX - square.minX + 1
  const inset = Math.round(0.025 * side)
  const bounds = {
    minX: square.minX + inset,
    maxX: square.maxX - inset,
    minY: square.minY + inset,
    maxY: square.maxY - inset,
  }
  const inkColor = (x: number, y: number): 'red' | 'green' | null => {
    const [r, g, b] = pixel(image, x, y)
    if (g >= 130 || b >= 100) return null
    if (r > 2 * g) return 'red'
    return r < 90 && g > 1.2 * r ? 'green' : null
  }
  const components = [...labelComponents(bounds, (x, y) => inkColor(x, y) ? true : null)]
    .filter((component) => component.area > 0.0015 * side ** 2)
  const glyphs = components.filter((component) => component.maxY - component.minY > 0.35 * side)
  if (glyphs.length < 1 || glyphs.length > 2) return unreadable
  const glyphBounds = {
    minX: Math.min(...glyphs.map((glyph) => glyph.minX)),
    maxX: Math.max(...glyphs.map((glyph) => glyph.maxX)),
    minY: Math.min(...glyphs.map((glyph) => glyph.minY)),
    maxY: Math.max(...glyphs.map((glyph) => glyph.maxY)),
  }
  let red = 0
  let green = 0
  for (let y = glyphBounds.minY; y <= glyphBounds.maxY; y += 1) {
    for (let x = glyphBounds.minX; x <= glyphBounds.maxX; x += 1) {
      const color = inkColor(x, y)
      if (color === 'red') red += 1
      if (color === 'green') green += 1
    }
  }
  if (Math.min(red, green) > 0.1 * (red + green)) return { number: null, colorMismatch: true }
  const color = red > green ? 'red' : 'green'
  const pipPixels: [number, number][] = []
  let mismatchedPips = 0
  const pipTop = Math.max(glyphBounds.maxY + 1, Math.round(square.minY + 0.72 * side))
  for (let y = pipTop; y <= square.minY + 0.88 * side; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const pipColor = inkColor(x, y)
      if (pipColor) {
        pipPixels.push([x, y])
        if (pipColor !== color) mismatchedPips += 1
      }
    }
  }
  if (pipPixels.length === 0) return unreadable
  const left = Math.min(...pipPixels.map(([x]) => x))
  const right = Math.max(...pipPixels.map(([x]) => x))
  const height = Math.max(...pipPixels.map(([, y]) => y)) - Math.min(...pipPixels.map(([, y]) => y)) + 1
  if (height < 0.035 * side || height > 0.12 * side) return unreadable

  // Extent preserves the count when antialiasing joins adjacent pips.
  const diameter = 0.07 * side
  const estimated = 1 + (right - left + 1 - diameter) / (0.14 * side)
  const pips = Math.round(estimated)
  if (pips < 1 || pips > 5 || Math.abs(estimated - pips) > 0.3) return unreadable
  const pitch = pips === 1 ? 0 : (right - left + 1 - diameter) / (pips - 1)
  for (let pip = 0; pip < pips; pip += 1) {
    const center = left + (diameter - 1) / 2 + pip * pitch
    const area = pipPixels.filter(([x]) => Math.abs(x - center) <= 0.06 * side).length
    if (area < 0.001 * side ** 2 || area > 0.015 * side ** 2) return unreadable
  }
  const holes = enclosedHoles(glyphBounds, (x, y) => inkColor(x, y) !== null, 0.002 * side ** 2).length
  let number: number | null = null
  if (pips <= 3) number = glyphs.length === 2 ? 13 - pips : pips + 1
  else if (glyphs.length === 1 && pips === 4) number = holes === 1 ? 9 : holes === 0 ? 5 : null
  else if (glyphs.length === 1 && pips === 5) number = holes === 2 ? 8 : holes === 1 ? 6 : null
  return {
    number,
    colorMismatch: mismatchedPips > 0.1 * pipPixels.length ||
      (number !== null && isRedToken(number) !== (color === 'red')),
  }
}

export function hasRobber(image: RgbaImage, x: number, y: number, size: number): boolean {
  const components = [...labelComponents({
    minX: Math.round(x - 0.8 * size),
    maxX: Math.round(x - 0.25 * size),
    minY: Math.round(y - 0.6 * size),
    maxY: Math.round(y + 0.4 * size),
  }, (px, py) => nearColor(pixel(image, px, py), ROBBER_COLOR, 9) ? true : null)]
    .filter((component) => component.area > 0.04 * size ** 2 && component.area < 0.1 * size ** 2 &&
      component.maxX - component.minX < 0.4 * size && component.maxY - component.minY < 0.4 * size)

  // The separate round head and wider body distinguish the pawn from ore artwork.
  return components.some((head) => head.y < y - 0.15 * size && components.some((body) =>
    Math.abs(body.x - head.x) < 0.05 * size && body.y - head.y > 0.22 * size && body.y - head.y < 0.4 * size,
  ))
}
