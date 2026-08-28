import { layoutRows } from '../model/layouts'
import type { AxialCoord, LayoutId, TileKind } from '../model/types'
import { nearColor, pixel, type Rgb, type RgbaImage } from './image'
import type { ParserPalette } from './palette'
import { findTileComponents, type TileComponent } from './tiles'

export interface RegisteredTile extends AxialCoord {
  tile: TileKind
}

export interface Registration {
  layout: LayoutId
  bandTop: number
  bandBottom: number
  size: number
  hexWidth: number
  originX: number
  originY: number
  tiles: RegisteredTile[]
  sharpness: number
  softInput: boolean
  maxResidual: number
  center(coord: AxialCoord): [number, number]
}

function findBoardBand(image: RgbaImage, bg: Rgb): [number, number] | null {
  let top = -1
  let bottom = -1
  for (let y = 0; y < image.height; y += 4) {
    let matches = 0
    let samples = 0
    for (let x = 0; x < image.width; x += 8) {
      samples += 1
      if (nearColor(pixel(image, x, y), bg, 12)) matches += 1
    }
    if (matches / samples > 0.3) {
      if (top < 0) top = y
      bottom = y
    }
  }
  return top < 0 ? null : [top, bottom]
}

export function registerBoard(image: RgbaImage, palette: ParserPalette): Registration | null {
  const band = findBoardBand(image, palette.bgBlue)
  if (!band) return null
  const found = findTileComponents(image, palette, band[0], band[1])
  if (!found) return null
  const tolerance = 0.35 * Math.sqrt(found.maxArea)
  const rows: { y: number; tiles: TileComponent[] }[] = []
  for (const component of [...found.components].sort((a, b) => a.y - b.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - component.y) < tolerance)
    if (row) {
      row.tiles.push(component)
      row.y = row.tiles.reduce((sum, tile) => sum + tile.y, 0) / row.tiles.length
    } else rows.push({ y: component.y, tiles: [component] })
  }
  const signature = rows.map((row) => row.tiles.length).join('-')
  const layout: LayoutId | null =
    signature === '3-4-5-4-3' ? 'standard4' : signature === '3-4-5-6-5-4-3' ? 'extension6' : null
  if (!layout) return null
  const specs = layoutRows(layout)
  const observations: (RegisteredTile & { x: number; y: number })[] = []
  rows.forEach((row, rowIndex) => {
    row.tiles.sort((a, b) => a.x - b.x).forEach((tile, index) => observations.push({
      q: specs[rowIndex].qStart + index,
      r: specs[rowIndex].r,
      tile: tile.tile,
      x: tile.x,
      y: tile.y,
    }))
  })
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const us = observations.map((observation) => observation.q + observation.r / 2)
  const rs = observations.map((observation) => observation.r)
  const meanU = mean(us)
  const meanR = mean(rs)
  const meanX = mean(observations.map((observation) => observation.x))
  const meanY = mean(observations.map((observation) => observation.y))
  const hexWidth = observations.reduce((sum, observation, index) =>
    sum + (us[index] - meanU) * (observation.x - meanX), 0) /
    observations.reduce((sum, _observation, index) => sum + (us[index] - meanU) ** 2, 0)
  const vertical = observations.reduce((sum, observation, index) =>
    sum + (rs[index] - meanR) * (observation.y - meanY), 0) /
    observations.reduce((sum, _observation, index) => sum + (rs[index] - meanR) ** 2, 0)
  const size = vertical / 1.5
  const originX = meanX - hexWidth * meanU
  const originY = meanY - vertical * meanR
  const center = (coord: AxialCoord): [number, number] => [
    originX + hexWidth * (coord.q + coord.r / 2),
    originY + 1.5 * size * coord.r,
  ]
  const maxResidual = Math.max(...observations.map((observation) => {
    const [x, y] = center(observation)
    return Math.hypot(x - observation.x, y - observation.y)
  }))
  const references: Rgb[] = [
    palette.bgBlue,
    ...Object.values(palette.tiles),
    palette.tokenCream,
    palette.chipCream,
    palette.inkDark,
    palette.inkRed,
    palette.robberBlack,
    [43, 43, 43],
    ...Object.values(palette.player),
  ]
  let hits = 0
  let total = 0
  for (let y = band[0]; y <= band[1]; y += 4) {
    for (let x = 0; x < image.width; x += 4) {
      total += 1
      if (references.some((reference) => nearColor(pixel(image, x, y), reference, 10))) hits += 1
    }
  }
  const sharpness = hits / total
  return {
    layout,
    bandTop: band[0],
    bandBottom: band[1],
    size,
    hexWidth,
    originX,
    originY,
    tiles: observations.map(({ q, r, tile }) => ({ q, r, tile })),
    sharpness,
    softInput: sharpness < 0.96,
    maxResidual,
    center,
  }
}
