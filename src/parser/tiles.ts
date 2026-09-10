import type { TileKind } from '../model/types'
import { labelComponents } from './components'
import { pixel, type RgbaImage } from './image'
import { classifyTile, type ParserPalette } from './palette'

export interface TileComponent {
  tile: TileKind
  x: number
  y: number
  area: number
}

export function findTileComponents(
  image: RgbaImage,
  palette: ParserPalette,
  bandTop: number,
  bandBottom: number,
): { components: TileComponent[]; maxArea: number } | null {
  const raw = [...labelComponents(
    { minX: 0, maxX: image.width - 1, minY: bandTop, maxY: bandBottom },
    (x, y) => classifyTile(pixel(image, x, y), palette),
    { discardAdjacent: true },
  )]
  const aspectPassing = raw.filter((component) => {
    const aspect = (component.maxX - component.minX + 1) / (component.maxY - component.minY + 1)
    return component.area >= 64 && aspect > 0.6 && aspect < 1.3
  })
  if (aspectPassing.length === 0) return null
  const maxArea = Math.max(...aspectPassing.map((component) => component.area))
  const components = aspectPassing
    .filter((component) => component.area >= 0.35 * maxArea && component.area <= 1.2 * maxArea)
    .map((component) => ({
      tile: component.label,
      x: component.x,
      y: component.y,
      area: component.area,
    }))
  return { components, maxArea }
}
