import { enclosedHoles, insideBounds, labelComponents } from '../../components'
import { pixel, type RgbaImage } from '../../image'

export function readCounter(image: RgbaImage, x: number, y: number, scale: number, white: boolean): number | null {
  const bounds = {
    minX: Math.round(x - 0.3 * scale),
    maxX: Math.round(x + 0.3 * scale),
    minY: Math.round(y - 0.24 * scale),
    maxY: Math.round(y + 0.24 * scale),
  }
  const width = bounds.maxX - bounds.minX + 1
  const mask = new Uint8Array(width * (bounds.maxY - bounds.minY + 1))
  const offset = (x: number, y: number) => (y - bounds.minY) * width + x - bounds.minX
  const ink = (x: number, y: number) => mask[offset(x, y)] === 1
  const points: [number, number][] = []
  for (const component of labelComponents(bounds, (x, y) => {
    const color = pixel(image, x, y)
    return (white ? Math.min(...color) > 180 : Math.max(...color) < 120) ? true : null
  }, { visit: (x, y) => points.push([x, y]) })) {

    // The ribbon border can enter the crop, but never belongs to a digit.
    if (insideBounds(component, bounds)) {
      for (const [px, py] of points) mask[offset(px, py)] = 1
    }
    points.length = 0
  }

  // Column runs keep thin diagonal strokes together after downsampling.
  const glyphs: (typeof bounds)[] = []
  let current: typeof bounds | null = null
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    let top = Infinity
    let bottom = -Infinity
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      if (ink(x, y)) {
        top = Math.min(top, y)
        bottom = y
      }
    }
    if (bottom < top) current = null
    else if (current) {
      current.maxX = x
      current.minY = Math.min(current.minY, top)
      current.maxY = Math.max(current.maxY, bottom)
    } else {
      current = { minX: x, maxX: x, minY: top, maxY: bottom }
      glyphs.push(current)
    }
  }
  const digitsOnly = glyphs.filter((glyph) => glyph.maxY - glyph.minY > 0.2 * scale)
  if (digitsOnly.length < 1 || digitsOnly.length > 2) return null
  const digits: number[] = []
  for (const glyph of digitsOnly) {
    const width = glyph.maxX - glyph.minX + 1
    const height = glyph.maxY - glyph.minY + 1
    if (height < 0.23 * scale || height > 0.42 * scale || width / height < 0.15 || width / height > 0.9) return null
    const holes = enclosedHoles(glyph, ink, 0.002 * scale ** 2)
    const band = (from: number, to: number) => {
      let left = 0
      let right = 0
      let rows = 0
      for (let y = Math.ceil(from * height); y < to * height; y += 1) {
        let first = width
        let last = -1
        for (let x = 0; x < width; x += 1) {
          if (ink(glyph.minX + x, glyph.minY + y)) {
            first = Math.min(first, x)
            last = x
          }
        }
        if (last < first) continue
        left += first / width
        right += (last + 1) / width
        rows += 1
      }
      return { left: left / rows, right: right / rows, width: (right - left) / rows }
    }
    const upper = band(0.25, 0.4)
    const lower = band(0.6, 0.8)
    const bottom = band(0.85, 1)
    let digit: number | null = null
    if (width / height < 0.5 && holes.length === 0) digit = 1
    else if (holes.length === 2) digit = 8
    else if (holes.length === 1) {
      const hole = holes[0]
      const center = (hole.y - glyph.minY + 0.5) / height
      if ((hole.maxY - hole.minY + 1) / height > 0.58) digit = 0
      else if (bottom.width < 0.4 && bottom.right > 0.65 && center > 0.38 && center < 0.6) digit = 4
      else if (center > 0.58) digit = 6
      else if (center < 0.42) digit = 9
    } else if (holes.length === 0) {
      if (upper.left < 0.2 && upper.right < 0.7 && lower.left > 0.4) digit = 5
      else if (upper.left > 0.5 && lower.right < 0.72) {
        if (bottom.width > 0.75) digit = 2
        else if (bottom.width < 0.4 && bottom.right < 0.65) digit = 7
      } else if (upper.left > 0.5 && lower.left > 0.45 && lower.right > 0.85) digit = 3
    }
    if (digit === null) return null
    digits.push(digit)
  }
  return Number(digits.join(''))
}
