import { PORT_POOLS } from '../../../model/board'
import { axialKey, parseEdgeId } from '../../../model/coords'
import { boardGrid } from '../../../model/layouts'
import type { EdgeId, Port, Resource } from '../../../model/types'
import { labelComponents } from '../../components'
import { nearColor, pixel, type Rgb, type RgbaImage } from '../../image'
import type { ParseIssue } from '../types'
import type { ColonistRegistration } from './registration'

const SAIL_WHITE: Rgb = [255, 255, 255]

// ponytail: boards with moved harbours need edge detection instead.
const PORT_EDGES: EdgeId[] = [
  'e:0,-3;0,-2',
  'e:1,-2;2,-3',
  'e:2,-1;3,-2',
  'e:2,0;3,0',
  'e:1,1;1,2',
  'e:-1,2;-1,3',
  'e:-3,3;-2,2',
  'e:-3,1;-2,1',
  'e:-2,-1;-1,-1',
]

export function detectPorts(image: RgbaImage, registration: ColonistRegistration, issues: ParseIssue[]): Port[] {
  const grid = boardGrid('standard4')
  const types = PORT_EDGES.map((edgeId) => {
    const outside = parseEdgeId(edgeId).find((coord) => !grid.landKeys.has(axialKey(coord)))!
    const [x, y] = registration.center(outside)
    return readSail(image, x, y, registration.size)
  })
  const remaining = [...PORT_POOLS.standard4]
  let consistent = true
  for (const resource of types) {
    if (resource === undefined) continue
    const index = remaining.indexOf(resource)
    if (index < 0) consistent = false
    else remaining.splice(index, 1)
  }
  const missing = types.flatMap((type, index) => type === undefined ? [index] : [])
  if (consistent && missing.length === 1 && remaining.length === 1) {
    types[missing[0]] = remaining[0]
    issues.push({
      stage: 'ports',
      severity: 'warning',
      message: 'Harbour sail was hidden, inferred its type from the standard harbour distribution',
      ref: PORT_EDGES[missing[0]],
    })
  } else {
    for (const index of missing) issues.push({
      stage: 'ports',
      severity: 'unreadable',
      message: 'Harbour sail is missing or unreadable',
      ref: PORT_EDGES[index],
    })
  }
  if (!consistent) issues.push({ stage: 'ports', severity: 'unreadable', message: 'Harbour types disagree with the standard distribution' })
  return types.flatMap((resource, index) => resource === undefined ? [] : [{
    edgeId: PORT_EDGES[index],
    resource,
    rate: resource === null ? 3 : 2,
  }])
}

function readSail(image: RgbaImage, x: number, y: number, size: number): Resource | null | undefined {
  const sails = [...labelComponents({
    minX: Math.max(0, Math.round(x - 0.6 * size)),
    maxX: Math.min(image.width - 1, Math.round(x + 0.4 * size)),
    minY: Math.max(0, Math.round(y - 0.75 * size)),
    maxY: Math.min(image.height - 1, Math.round(y + 0.15 * size)),
  }, (px, py) => nearColor(pixel(image, px, py), SAIL_WHITE, 20) ? true : null)]
    .filter((component) => component.maxX - component.minX > 0.4 * size && component.maxX - component.minX < 0.6 * size &&
      component.maxY - component.minY > 0.4 * size && component.maxY - component.minY < 0.6 * size && component.area > 0.1 * size ** 2)
  if (sails.length !== 1) return undefined
  const sail = sails[0]
  const width = sail.maxX - sail.minX + 1
  const height = sail.maxY - sail.minY + 1
  const components = [...labelComponents({
    minX: Math.round(sail.minX + 0.13 * width),
    maxX: Math.round(sail.maxX - 0.13 * width),
    minY: Math.round(sail.minY + 0.1 * height),
    maxY: Math.round(sail.minY + 0.61 * height),
  }, (px, py) => {
    const [r, g, b] = pixel(image, px, py)
    return r < 170 && r > 1.15 * g && g < 130 && Math.abs(g - b) < 20 ? true : null
  })].filter((component) => component.area > 0.0002 * size ** 2).sort((a, b) => b.area - a.area)
  if (components.length === 0) return undefined
  const aspect = (component: typeof sail) => (component.maxX - component.minX + 1) / (component.maxY - component.minY + 1)
  const total = components.reduce((sum, component) => sum + component.area, 0)
  const largest = components[0]

  // The sail icons are silhouettes: rectangles, stones, a tree, an animal, or fine stalks.
  if (components.length === 7 && components.every((component) => aspect(component) > 1.5 && aspect(component) < 2.6)) return 'brick'
  if (components.length === 5 && components.every((component) => aspect(component) > 0.65 && aspect(component) < 1.5 && component.area > 0.001 * size ** 2)) return 'ore'
  if (largest.area > 0.015 * size ** 2 && largest.area > 0.9 * total) {
    if (aspect(largest) > 1.2 && aspect(largest) < 1.6) return 'sheep'
    if (aspect(largest) > 0.8 && aspect(largest) < 1.05) return 'wood'
  }
  if (components.length === 2) {
    const dot = components[1]
    if (aspect(largest) > 0.7 && aspect(largest) < 1 && dot.minY > largest.maxY &&
      dot.area > 0.1 * largest.area && dot.area < 0.3 * largest.area && Math.abs(dot.x - largest.x) < 0.03 * size) return null
  }
  if (components.length >= 4 && total > 0.004 * size ** 2 && total < 0.016 * size ** 2 &&
    Math.max(...components.map((component) => component.maxY)) - Math.min(...components.map((component) => component.minY)) > 0.18 * size) return 'wheat'
  return undefined
}
