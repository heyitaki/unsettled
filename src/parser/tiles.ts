import type { TileKind } from '../model/types'
import { labelComponents } from './components'
import { pixel, type Rgb, type RgbaImage } from './image'
import { nearest, type ParserPalette } from './palette'

export interface TileComponent {
  tile: TileKind
  x: number
  y: number
  area: number
}

export function findTileComponents(
  image: RgbaImage,
  palette: ParserPalette,
): { components: TileComponent[]; maxArea: number } | null {
  const entries = Object.entries(palette.tiles) as [TileKind, Rgb][]
  const raw = [...labelComponents(
    { minX: 0, maxX: image.width - 1, minY: 0, maxY: image.height - 1 },
    (x, y) => nearest(pixel(image, x, y), entries, 25),
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
