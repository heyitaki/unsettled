import { axialKey } from '../../../model/coords'
import { layoutRows } from '../../../model/layouts'
import type { AxialCoord } from '../../../model/types'
import { labelComponents, type Bounds } from '../../components'
import type { RgbaImage } from '../../image'
import { isColonistScreen, isTokenCream } from './palette'
import { pieceWindowsFit } from './pieces'

export type TokenSquare = Bounds & { x: number; y: number }

export interface ColonistRegistration {
  size: number
  squares: (TokenSquare & AxialCoord)[]
  center(coord: AxialCoord): [number, number]
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

export function registerBoard(image: RgbaImage): ColonistRegistration | null {
  if (!isColonistScreen(image)) return null
  const squares = [...labelComponents(
    { minX: 0, maxX: image.width - 1, minY: 0, maxY: image.height - 1 },
    (x, y) => {
      const index = (y * image.width + x) * 4
      const r = image.data[index]
      if (Math.abs(r - 233) > 9) return null
      return isTokenCream([r, image.data[index + 1], image.data[index + 2]]) ? true : null
    },
  )].filter((component) => {
    const width = component.maxX - component.minX + 1
    const height = component.maxY - component.minY + 1
    return Math.abs(width / height - 1) < 0.12 &&
      component.area > 0.2 * width * height && component.area < 0.9 * width * height
  }).map((component): TokenSquare => ({
    ...component,
    x: (component.minX + component.maxX) / 2,
    y: (component.minY + component.maxY) / 2,
  }))
  if (squares.length < 18) return null
  const side = Math.max(...squares.map((square) => square.maxX - square.minX + 1))
  const candidates = squares.filter((square) => Math.abs((square.maxX - square.minX + 1) / side - 1) < 0.12)
  const rows: TokenSquare[][] = []
  for (const square of candidates.sort((a, b) => a.y - b.y)) {
    const row = rows.find((entry) => Math.abs(entry[0].y - square.y) < side / 2)
    if (row) row.push(square)
    else rows.push([square])
  }

  // ponytail: 5 to 6 player boards need a fixture first.
  if (rows.length !== 5 || candidates.length !== 18) return null
  const specs = layoutRows('standard4')
  if (rows.some((row, i) => row.length > specs[i].count || row.length < specs[i].count - 1)) return null
  const gaps = rows.flatMap((row) => {
    row.sort((a, b) => a.x - b.x)
    return row.slice(1).map((square, i) => square.x - row[i].x)
  })
  const hexWidth = median(gaps)
  const vertical = median(rows.slice(1).map((row, i) => median(row.map((s) => s.y)) - median(rows[i].map((s) => s.y))))
  const size = vertical / 1.5
  if (Math.abs(hexWidth / (Math.sqrt(3) * size) - 1) > 0.03 || Math.abs(side / size - 0.65) > 0.06) return null
  const tokenOriginY = median(rows.map((row, i) => median(row.map((s) => s.y)) - specs[i].r * vertical))
  for (let firstQ = specs[0].qStart; firstQ <= specs[0].qStart + 1; firstQ += 1) {
    const originX = rows[0][0].x - hexWidth * (firstQ + specs[0].r / 2)
    const registered = rows.flatMap((row, i) => row.map((square) => ({
      ...square,
      q: Math.round((square.x - originX) / hexWidth - specs[i].r / 2),
      r: specs[i].r,
    })))
    const valid = registered.every((square) => {
      const spec = specs[square.r + 2]
      return square.q >= spec.qStart && square.q < spec.qStart + spec.count &&
        Math.abs(square.x - originX - hexWidth * (square.q + square.r / 2)) < 0.04 * size &&
        Math.abs(square.y - tokenOriginY - vertical * square.r) < 0.04 * size
    })
    if (!valid || new Set(registered.map(axialKey)).size !== 18) continue
    const center = (coord: AxialCoord): [number, number] => [
      originX + hexWidth * (coord.q + coord.r / 2),
      tokenOriginY + vertical * coord.r - 0.32 * size,
    ]
    const registration = { size, squares: registered, center }
    if (!pieceWindowsFit(image, registration)) return null
    return registration
  }
  return null
}
