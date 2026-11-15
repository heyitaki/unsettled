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
  bandLeft: number
  bandRight: number
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

export function registerBoard(image: RgbaImage, palette: ParserPalette): Registration | null {
  const found = findTileComponents(image, palette)
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
  // Resource cards in the hand share the tile colours and size, so they form
  // extra rows outside the board: take the run of rows that spells a layout.
  const counts = rows.map((row) => row.tiles.length)
  let layout: LayoutId | null = null
  let start = -1
  for (const candidate of ['extension6', 'standard4'] as const) {
    const pattern = layoutRows(candidate).map((spec) => spec.count)
    start = counts.findIndex((_count, index) => pattern.every((length, offset) => counts[index + offset] === length))
    if (start >= 0) {
      layout = candidate
      break
    }
  }
  if (!layout) return null
  const specs = layoutRows(layout)
  const observations: (RegisteredTile & { x: number; y: number })[] = []
  rows.slice(start, start + specs.length).forEach((row, rowIndex) => {
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

  // Interior discs exclude vertex overlays and edge pieces while retaining token antialiasing.
  const radius = 0.65 * size
  for (const tile of observations) {
    const [cx, cy] = center(tile)
    for (let y = Math.round(cy - radius); y <= cy + radius; y += 4) {
      for (let x = Math.round(cx - radius); x <= cx + radius; x += 4) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue
        total += 1
        if (references.some((reference) => nearColor(pixel(image, x, y), reference, 10))) hits += 1
      }
    }
  }
  const sharpness = hits / total
  const xs = observations.map((tile) => center(tile)[0])
  const ys = observations.map((tile) => center(tile)[1])
  return {
    layout,
    bandLeft: Math.max(0, Math.floor(Math.min(...xs) - hexWidth / 2 - 0.7 * size)),
    bandRight: Math.min(image.width - 1, Math.ceil(Math.max(...xs) + hexWidth / 2 + 0.7 * size)),
    bandTop: Math.max(0, Math.floor(Math.min(...ys) - 1.7 * size)),
    bandBottom: Math.min(image.height - 1, Math.ceil(Math.max(...ys) + 1.7 * size)),
    size,
    hexWidth,
    originX,
    originY,
    tiles: observations.map(({ q, r, tile }) => ({ q, r, tile })),
    sharpness,
    softInput: sharpness < 0.94,
    maxResidual,
    center,
  }
}
