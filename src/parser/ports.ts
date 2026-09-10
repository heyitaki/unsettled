import { parseEdgeId } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Port, Resource } from '../model/types'
import { labelComponents } from './components'
import { nearColor, pixel, type RgbaImage } from './image'
import { classifyTile, type ParserPalette } from './palette'
import type { Registration } from './registration'

export interface DetectedPort extends Port {
  ambiguous: boolean
}

export interface PortDetection {
  ports: DetectedPort[]
  duplicateEdgeIds: Port['edgeId'][]
}

interface Pill {
  centerX: number
  centerY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function detectPorts(
  image: RgbaImage,
  palette: ParserPalette,
  registration: Registration,
): PortDetection {
  const isPill = (x: number, y: number) => {
    const color = pixel(image, x, y)
    return nearColor(color, palette.tokenCream, 18) || nearColor(color, palette.chipCream, 18)
  }
  const insideHex = (x: number, y: number) => registration.tiles.some((tile) => {
    const [centerX, centerY] = registration.center(tile)
    return (x - centerX) ** 2 + (y - centerY) ** 2 < (1.02 * registration.size) ** 2
  })
  const pills: Pill[] = []
  for (const component of labelComponents(
    { minX: 0, maxX: image.width - 1, minY: registration.bandTop, maxY: registration.bandBottom },
    (x, y) => isPill(x, y) ? true : null,
    { step: 2 },
  )) {
    const { x: centerX, y: centerY, minX, maxX, minY, maxY } = component
    const area = component.area * 4
    const aspect = (maxX - minX) / Math.max(1, maxY - minY)
    if (!insideHex(centerX, centerY) && area > 0.12 * registration.size ** 2 &&
      area < 1.9 * registration.size ** 2 && aspect > 1.5 && aspect < 4.5) {
      pills.push({ centerX, centerY, minX, maxX, minY, maxY })
    }
  }
  const grid = boardGrid(registration.layout)
  const midpoint = (edgeId: Port['edgeId']): [number, number] => {
    const [a, b] = parseEdgeId(edgeId)
    const ap = registration.center(a)
    const bp = registration.center(b)
    return [(ap[0] + bp[0]) / 2, (ap[1] + bp[1]) / 2]
  }
  const detected = pills.map((pill) => {
    const votes = new Map<Resource | 'desert', number>()
    const dotRegionRight = pill.minX + 0.4 * (pill.maxX - pill.minX)
    for (let y = pill.minY; y <= pill.maxY; y += 1) {
      for (let x = pill.minX; x <= dotRegionRight; x += 1) {
        const tile = classifyTile(pixel(image, x, y), palette)
        if (tile) votes.set(tile, (votes.get(tile) ?? 0) + 1)
      }
    }
    const dot = [...votes].sort((a, b) => b[1] - a[1])[0]
    const resource = dot && dot[0] !== 'desert' && dot[1] > 0.006 * registration.size ** 2 ? dot[0] : null
    const ranked = grid.coastalEdgeIds.map((edgeId) => {
      const [x, y] = midpoint(edgeId)
      return { edgeId, distance: Math.hypot(x - pill.centerX, y - pill.centerY) }
    }).sort((a, b) => a.distance - b.distance)
    return {
      edgeId: ranked[0].edgeId,
      resource,
      rate: resource ? 2 : 3,
      ambiguous: ranked[1].distance / ranked[0].distance < 1.15,
    }
  })
  const ports: DetectedPort[] = []
  const duplicateEdgeIds: Port['edgeId'][] = []
  const claimed = new Set<Port['edgeId']>()
  for (const port of detected) {
    if (claimed.has(port.edgeId)) duplicateEdgeIds.push(port.edgeId)
    else {
      claimed.add(port.edgeId)
      ports.push(port)
    }
  }
  return { ports, duplicateEdgeIds }
}
