import type { Resource, TileKind } from '../model/types'
import { pixel, type RgbaImage } from './image'
import { classifyTile, type ParserPalette } from './palette'

export interface TileComponent {
  tile: TileKind
  x: number
  y: number
  area: number
}

interface MutableComponent {
  tile: TileKind
  area: number
  sumX: number
  sumY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function findTileComponents(
  image: RgbaImage,
  palette: ParserPalette,
  bandTop: number,
  bandBottom: number,
): { components: TileComponent[]; maxArea: number } | null {
  const labels = new Int32Array(image.width * image.height).fill(-1)
  const raw: MutableComponent[] = []
  for (let y = bandTop; y <= bandBottom; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x
      if (labels[index] !== -1) continue
      const tile = classifyTile(pixel(image, x, y), palette)
      if (!tile) {
        labels[index] = -2
        continue
      }
      const id = raw.length
      const component: MutableComponent = {
        tile,
        area: 0,
        sumX: 0,
        sumY: 0,
        minX: image.width,
        maxX: 0,
        minY: image.height,
        maxY: 0,
      }
      const stack = [index]
      labels[index] = id
      while (stack.length > 0) {
        const current = stack.pop()
        if (current === undefined) break
        const currentX = current % image.width
        const currentY = Math.floor(current / image.width)
        component.area += 1
        component.sumX += currentX
        component.sumY += currentY
        component.minX = Math.min(component.minX, currentX)
        component.maxX = Math.max(component.maxX, currentX)
        component.minY = Math.min(component.minY, currentY)
        component.maxY = Math.max(component.maxY, currentY)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nextX = currentX + dx
          const nextY = currentY + dy
          if (nextX < 0 || nextX >= image.width || nextY < bandTop || nextY > bandBottom) continue
          const next = nextY * image.width + nextX
          if (labels[next] !== -1) continue
          if (classifyTile(pixel(image, nextX, nextY), palette) === tile) {
            labels[next] = id
            stack.push(next)
          } else labels[next] = -2
        }
      }
      raw.push(component)
    }
  }
  const aspectPassing = raw.filter((component) => {
    const aspect = (component.maxX - component.minX + 1) / (component.maxY - component.minY + 1)
    return component.area >= 64 && aspect > 0.6 && aspect < 1.3
  })
  if (aspectPassing.length === 0) return null
  const maxArea = Math.max(...aspectPassing.map((component) => component.area))
  const components = aspectPassing
    .filter((component) => component.area >= 0.35 * maxArea && component.area <= 1.2 * maxArea)
    .map((component) => ({
      tile: component.tile as Resource | 'desert',
      x: component.sumX / component.area,
      y: component.sumY / component.area,
      area: component.area,
    }))
  return { components, maxArea }
}
