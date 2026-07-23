import { nearColor, pixel, type RgbaImage } from './image'
import type { ParserPalette } from './palette'

interface InkComponent {
  points: [number, number][]
  red: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface TokenAnalysis {
  robber: boolean
  corePixels: number
  hasToken: boolean
  number: number | null
  suspect: boolean
  redMismatch: boolean
}

const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function analyzeToken(
  image: RgbaImage,
  palette: ParserPalette,
  centerX: number,
  centerY: number,
  size: number,
): TokenAnalysis {
  const robberRadius = Math.round(0.55 * size)
  const isDark = (x: number, y: number) => nearColor(pixel(image, x, y), [35, 35, 35], 45)
  const erosion = Math.max(1, Math.round(0.03 * size))
  let corePixels = 0
  for (let y = Math.round(centerY - robberRadius); y <= Math.round(centerY + robberRadius); y += 1) {
    for (let x = Math.round(centerX - robberRadius); x <= Math.round(centerX + robberRadius); x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > robberRadius ** 2 || !isDark(x, y)) continue
      let core = true
      for (let dy = -erosion; core && dy <= erosion; dy += 1) {
        for (let dx = -erosion; core && dx <= erosion; dx += 1) {
          if (!isDark(x + dx, y + dy)) core = false
        }
      }
      if (core) corePixels += 1
    }
  }
  const robber = corePixels > 0.03 * size ** 2
  const creamRadius = Math.round(0.5 * size)
  let creamPixels = 0
  let creamSumX = 0
  let creamSumY = 0
  for (let y = Math.round(centerY - creamRadius); y <= Math.round(centerY + creamRadius); y += 1) {
    for (let x = Math.round(centerX - creamRadius); x <= Math.round(centerX + creamRadius); x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > creamRadius ** 2) continue
      if (nearColor(pixel(image, x, y), palette.tokenCream, 18)) {
        creamPixels += 1
        creamSumX += x
        creamSumY += y
      }
    }
  }
  const hasToken = creamPixels > 0.18 * Math.PI * creamRadius ** 2
  if (creamPixels < 0.3 * Math.PI * creamRadius ** 2 || robber) {
    return { robber, corePixels, number: null, hasToken, suspect: false, redMismatch: false }
  }
  const tokenX = creamSumX / creamPixels
  const tokenY = creamSumY / creamPixels
  let ringInner = Math.round(0.5 * size)
  for (let ray = 0; ray < 16; ray += 1) {
    const angle = 2 * Math.PI * ray / 16
    let run = 0
    const minimumRun = Math.max(2, Math.round(0.025 * size))
    for (let distance = Math.round(0.25 * size); distance < 0.55 * size; distance += 1) {
      const color = pixel(image, tokenX + distance * Math.cos(angle), tokenY + distance * Math.sin(angle))
      if (nearColor(color, [43, 43, 43], 25)) {
        run += 1
        if (run >= minimumRun) {
          ringInner = Math.min(ringInner, distance - run + 1)
          break
        }
      } else run = 0
    }
  }
  const scanRadius = ringInner - 2
  const ink = new Map<string, boolean>()
  for (let y = Math.round(tokenY - scanRadius); y <= Math.round(tokenY + scanRadius); y += 1) {
    for (let x = Math.round(tokenX - scanRadius); x <= Math.round(tokenX + scanRadius); x += 1) {
      if ((x - tokenX) ** 2 + (y - tokenY) ** 2 > scanRadius ** 2) continue
      const color = pixel(image, x, y)
      if (nearColor(color, palette.inkDark, 55) || nearColor(color, palette.robberBlack, 30)) {
        ink.set(`${x},${y}`, false)
      } else if (nearColor(color, palette.inkRed, 35)) ink.set(`${x},${y}`, true)
    }
  }
  const seen = new Set<string>()
  const components: InkComponent[] = []
  for (const key of ink.keys()) {
    if (seen.has(key)) continue
    const stack = [key]
    seen.add(key)
    const component: InkComponent = {
      points: [],
      red: 0,
      minX: image.width,
      maxX: 0,
      minY: image.height,
      maxY: 0,
    }
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      const [x, y] = current.split(',').map(Number)
      component.points.push([x, y])
      if (ink.get(current)) component.red += 1
      component.minX = Math.min(component.minX, x)
      component.maxX = Math.max(component.maxX, x)
      component.minY = Math.min(component.minY, y)
      component.maxY = Math.max(component.maxY, y)
      for (const [dx, dy] of neighbors) {
        const next = `${x + dx},${y + dy}`
        if (ink.has(next) && !seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    if (component.points.length >= Math.max(4, 0.0008 * size ** 2)) components.push(component)
  }
  if (components.length === 0) {
    return { robber, corePixels, number: null, hasToken: true, suspect: true, redMismatch: false }
  }
  const height = (component: InkComponent) => component.maxY - component.minY + 1
  const maximumHeight = Math.max(...components.map(height))
  const glyphs = components.filter((component) => height(component) > 0.55 * maximumHeight)
  const pips = components.filter((component) =>
    height(component) <= 0.45 * maximumHeight &&
    (component.minY + component.maxY) / 2 > tokenY,
  )
  if (glyphs.length === 0) {
    return { robber, corePixels, number: null, hasToken: true, suspect: true, redMismatch: false }
  }
  if (pips.length > 0) {
    const areas = pips.map((component) => component.points.length).sort((a, b) => a - b)
    const median = areas[Math.floor(areas.length / 2)]
    const badShape = pips.some((component) => {
      const aspect = (component.maxX - component.minX + 1) / (component.maxY - component.minY + 1)
      return aspect < 0.5 || aspect > 1.5
    })
    if (badShape || areas.some((area) => area < 0.6 * median || area > 1.6 * median) ||
      median < 0.0004 * size ** 2 || median > 0.003 * size ** 2) {
      return { robber, corePixels, number: null, hasToken: true, suspect: true, redMismatch: false }
    }
  }
  let redPixels = 0
  let blackPixels = 0
  for (const glyph of glyphs) {
    for (const [x, y] of glyph.points) {
      const color = pixel(image, x, y)
      if (nearColor(color, palette.inkRed, 35)) redPixels += 1
      else if (nearColor(color, palette.robberBlack, 30)) blackPixels += 1
    }
  }
  const isRed = redPixels > blackPixels
  const minX = Math.min(...glyphs.map((glyph) => glyph.minX)) - 2
  const maxX = Math.max(...glyphs.map((glyph) => glyph.maxX)) + 2
  const minY = Math.min(...glyphs.map((glyph) => glyph.minY)) - 2
  const maxY = Math.max(...glyphs.map((glyph) => glyph.maxY)) + 2
  const backgroundSeen = new Set<string>()
  let holes = 0
  const flood = (startX: number, startY: number, record: boolean) => {
    const stack: [number, number][] = [[startX, startY]]
    backgroundSeen.add(`${startX},${startY}`)
    let escaped = false
    let area = 0
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      const [x, y] = current
      area += 1
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < minX || nextX > maxX || nextY < minY || nextY > maxY) {
          escaped = true
          continue
        }
        const key = `${nextX},${nextY}`
        if (!ink.has(key) && !backgroundSeen.has(key)) {
          backgroundSeen.add(key)
          stack.push([nextX, nextY])
        }
      }
    }
    if (record && !escaped && area >= Math.max(3, 0.0006 * size ** 2)) holes += 1
  }
  flood(minX, minY, false)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const key = `${x},${y}`
      if (!ink.has(key) && !backgroundSeen.has(key)) flood(x, y, true)
    }
  }
  const pairs: Record<number, [number, number]> = {
    1: [2, 12],
    2: [3, 11],
    3: [4, 10],
    4: [5, 9],
    5: [6, 8],
  }
  const pair = pairs[pips.length]
  if (!pair) return { robber, corePixels, number: null, hasToken: true, suspect: true, redMismatch: false }
  let number: number
  if (pair[1] >= 10) number = glyphs.length >= 2 ? pair[1] : pair[0]
  else if (pips.length === 4) number = holes >= 1 ? 9 : 5
  else number = holes >= 2 ? 8 : 6
  return {
    robber,
    corePixels,
    number,
    hasToken: true,
    suspect: false,
    redMismatch: (number === 6 || number === 8) !== isRed,
  }
}
