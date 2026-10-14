import { parseEdgeId } from '../../../model/coords'
import { boardGrid } from '../../../model/layouts'
import type { Board, Building, EdgeId, Player, Road, VertexId } from '../../../model/types'
import { insideBounds, labelComponents, type Bounds, type Fill } from '../../components'
import { pixel, type Rgb, type RgbaImage } from '../../image'
import { edgePoint, snakeOrder, vertexPoint } from '../../pieces'
import type { ParseIssue } from '../types'
import { SEATS, seatPlayer, type Seat } from './palette'
import type { ColonistRegistration } from './registration'

export function pieceWindowsFit(image: RgbaImage, registration: ColonistRegistration): boolean {
  const grid = boardGrid('standard4')
  const windows = [
    ...grid.vertexIds.map((id) => buildingWindow(registration, id)),
    ...grid.edgeIds.map((id) => roadWindow(registration, id)),
  ]
  return windows.every(({ bounds, point }) => {
    const outline = Math.floor(0.06 * registration.size)
    return [bounds.minX - outline, bounds.maxX + outline].every((x) =>
      [bounds.minY, bounds.maxY].every((y) => {
        const [px, py] = point(x, y).map(Math.round)
        return px >= 0 && px < image.width && py >= 0 && py < image.height
      }))
  })
}

export function detectPieces(image: RgbaImage, registration: ColonistRegistration, issues: ParseIssue[]): {
  buildings: Building[]
  roads: Road[]
  players: Player[]
} {
  const grid = boardGrid('standard4')
  const size = registration.size
  const buildings: Building[] = []
  const roads: Road[] = []
  const unreadable = (ref: string) => issues.push({
    stage: 'pieces',
    severity: 'unreadable',
    message: 'Piece could not be identified confidently',
    ref,
  })
  for (const vertexId of grid.vertexIds) {
    const { bounds, x, y } = buildingWindow(registration, vertexId)
    const sample = (dx: number, dy: number) => pixel(image, x + dx, y + dy)
    const fills = collectFills(bounds, sample, size, false, classifySeat)
      .filter((fill) => fill.maxY - fill.minY > 0.4 * size)
    if (fills.reduce((area, fill) => area + fill.area, 0) < 0.12 * size ** 2) {
      if (looksOccupied(bounds, sample, size, false)) unreadable(vertexId)
      continue
    }
    if (fills.length !== 1) {
      unreadable(vertexId)
      continue
    }
    const fill = fills[0]
    const width = (fill.maxX - fill.minX + 1) / size
    const height = (fill.maxY - fill.minY + 1) / size
    const tier = width > 0.46 && width < 0.62 ? 'settlement' : width > 0.66 && width < 0.82 ? 'city' : null
    if (!tier || height < 0.48 || height > 0.7 || !outlined(fill, sample, size)) {
      unreadable(vertexId)
      continue
    }
    buildings.push({ vertexId, playerId: seatPlayer(fill.label).id, tier })
  }
  for (const edgeId of grid.edgeIds) {
    const { bounds, x, y, nx, ny } = roadWindow(registration, edgeId)
    const sample = (across: number, along: number) => pixel(image, x + across * nx - along * ny, y + across * ny + along * nx)
    const fills = collectFills(bounds, sample, size, true, classifySeat)
    const span = Math.max(...fills.map((fill) => fill.maxX)) - Math.min(...fills.map((fill) => fill.minX))

    // Parallel tile borders leave the middle of an empty edge uncoloured.
    const centered = [-0.2, 0, 0.2].filter((along) => {
      const seat = classifySeat(sample(0, along * size))
      return fills.some((fill) => fill.label === seat)
    }).length >= 2
    if (!centered || fills.reduce((area, fill) => area + fill.area, 0) < 0.06 * size ** 2 || span < 0.12 * size) {
      if (looksOccupied(bounds, sample, size, true)) unreadable(edgeId)
      continue
    }
    if (fills.length !== 1 || fills[0].maxX - fills[0].minX > 0.25 * size || !outlined(fills[0], sample, size)) {
      unreadable(edgeId)
      continue
    }
    roads.push({ edgeId, playerId: seatPlayer(fills[0].label).id })
  }
  const used = new Set([...buildings, ...roads].map((piece) => piece.playerId))
  const players = SEATS.map(seatPlayer).filter((player) => used.has(player.id))
  if (players.length === 0) players.push(seatPlayer('red'))
  return { buildings, roads, players }
}

export function orderPieces({ buildings, roads, players }: Pick<Board, 'buildings' | 'roads' | 'players'>, issues: ParseIssue[]) {
  const seatOrder = (id: string) => players.findIndex((player) => player.id === id)
  buildings = [...buildings].sort((a, b) => seatOrder(a.playerId) - seatOrder(b.playerId))
  roads = [...roads].sort((a, b) => seatOrder(a.playerId) - seatOrder(b.playerId))
  const byPlayer = players.map((player) => buildings.filter((building) => building.playerId === player.id))
  if (buildings.every((building) => building.tier === 'settlement') && byPlayer.every((placed) => placed.length <= 2)) {
    if (byPlayer.some((placed) => placed.length === 2)) issues.push({
      stage: 'pieces',
      severity: 'warning',
      message: "The order of each player's two settlements could not be told",
    })
    return {
      buildings: snakeOrder(byPlayer),
      roads,
    }
  }
  return { buildings, roads }
}

const brightness = ([r, g, b]: Rgb) => 0.21 * r + 0.72 * g + 0.07 * b

function buildingWindow(registration: ColonistRegistration, vertexId: VertexId) {
  const [x, y] = vertexPoint(registration, vertexId)
  const size = registration.size
  return {
    bounds: {
      minX: Math.round(-0.45 * size),
      maxX: Math.round(0.5 * size),
      minY: Math.round(-0.58 * size),
      maxY: Math.round(0.3 * size),
    },
    x,
    y,
    point: (dx: number, dy: number): [number, number] => [x + dx, y + dy],
  }
}

function classifySeat([r, g, b]: Rgb): Seat | null {

  // Bright faces stay separate from outlines and terrain in both colour spaces.
  if (r > 120 && g < 0.4 * r && b < 0.5 * r) return 'red'
  if (b > 200 && b > 1.25 * g && b > 1.5 * r) return 'blue'
  if (g > 160 && r < 0.65 * g && b < 0.62 * g) return 'green'
  if (r > 160 && g > 0.45 * r && g < 0.71 * r && b < 0.43 * r) return 'orange'
  return null
}

function collectFills<Label>(
  bounds: Bounds,
  sample: (x: number, y: number) => Rgb,
  size: number,
  road: boolean,
  classify: (color: Rgb) => Label | null,
): Fill<Label>[] {
  const fills = new Map<Label, Fill<Label>>()
  for (const component of labelComponents(bounds, (x, y) => classify(sample(x, y)))) {
    if (component.area < 0.025 * size ** 2) continue
    if (road
      ? component.minX === bounds.minX || component.maxX === bounds.maxX || component.maxY - component.minY < 0.4 * size
      : !insideBounds(component, bounds)) continue

    // Roof seams split one building into several faces.
    const fill = fills.get(component.label)
    if (fill) {
      fill.area += component.area
      fill.minX = Math.min(fill.minX, component.minX)
      fill.maxX = Math.max(fill.maxX, component.maxX)
      fill.minY = Math.min(fill.minY, component.minY)
      fill.maxY = Math.max(fill.maxY, component.maxY)
    } else fills.set(component.label, component)
  }
  return [...fills.values()]
}

function looksOccupied(bounds: Bounds, sample: (x: number, y: number) => Rgb, size: number, road: boolean): boolean {

  // An enclosed light fill can reveal an unknown seat; tan corridors are empty edges.
  const fills = collectFills(bounds, sample, size, road, ([r, g, b]) =>
    brightness([r, g, b]) > 120 && !(r > g && g > b) ? true : null)
  return fills.some((fill) => {
    const width = (fill.maxX - fill.minX + 1) / size
    const height = (fill.maxY - fill.minY + 1) / size
    return road
      ? fill.area > 0.06 * size ** 2 && width > 0.13 && width < 0.25
      : fill.area > 0.12 * size ** 2 && width > 0.46 && width < 0.82 && height > 0.48 && height < 0.7 &&
        Math.abs(fill.minX + fill.maxX) < 0.3 * size
  })
}

function outlined(fill: Fill<Seat>, sample: (x: number, y: number) => Rgb, size: number): boolean {
  let rows = 0
  let dark = 0
  for (let y = fill.minY; y <= fill.maxY; y += 1) {
    let left = Infinity
    let right = -Infinity
    let brightest = 0
    for (let x = fill.minX; x <= fill.maxX; x += 1) {
      const color = sample(x, y)
      if (classifySeat(color) !== fill.label) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      brightest = Math.max(brightest, brightness(color))
    }
    if (right - left < 0.1 * size) continue
    rows += 1
    for (const [x, direction] of [[left, -1], [right, 1]]) {
      for (let distance = 0; distance <= 0.06 * size; distance += 1) {
        if (brightness(sample(x + direction * distance, y)) < 0.8 * brightest) {
          dark += 1
          break
        }
      }
    }
  }
  return rows > 0 && dark > 1.2 * rows
}

function roadWindow(registration: ColonistRegistration, edgeId: EdgeId) {
  const [a, b] = parseEdgeId(edgeId).map(registration.center)
  const [x, y] = edgePoint(registration, edgeId)
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nx = (b[0] - a[0]) / length
  const ny = (b[1] - a[1]) / length
  const size = registration.size
  return {
    bounds: {
      minX: Math.round(-0.22 * size),
      maxX: Math.round(0.22 * size),
      minY: Math.round(-0.32 * size),
      maxY: Math.round(0.32 * size),
    },
    x,
    y,
    nx,
    ny,

    // Across and along the edge, excluding the buildings at its ends.
    point: (across: number, along: number): [number, number] =>
      [x + across * nx - along * ny, y + across * ny + along * nx],
  }
}
