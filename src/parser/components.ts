export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface Fill<Label> extends Bounds {
  label: Label
  area: number
}

interface Component<Label> extends Fill<Label> {
  x: number
  y: number
}

interface LabelOptions {
  step?: number
  discardAdjacent?: boolean
  visit?: (x: number, y: number) => void
}

export const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function* labelComponents<Label>(
  bounds: Bounds,
  classify: (x: number, y: number) => Label | null,
  { step = 1, discardAdjacent = false, visit }: LabelOptions = {},
): Generator<Component<Label>> {
  const { minX, maxX, minY, maxY } = bounds
  const width = Math.max(0, maxX - minX + 1)
  const seen = new Uint8Array(width * Math.max(0, maxY - minY + 1))
  const index = (x: number, y: number) => (y - minY) * width + x - minX
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const current = index(x, y)
      if (seen[current]) continue
      const label = classify(x, y)
      seen[current] = 1
      if (label === null) continue
      const claim = (nextX: number, nextY: number): boolean => {
        if (nextX < minX || nextX > maxX || nextY < minY || nextY > maxY) return false
        const next = index(nextX, nextY)
        if (seen[next]) return false
        const matches = classify(nextX, nextY) === label

        // Tile detection consumes mismatched neighbors as part of its boundary.
        if (matches || discardAdjacent) seen[next] = 1
        return matches
      }
      yield floodComponent(x, y, label, claim, step, visit)
    }
  }
}

export function enclosedHoles(bounds: Bounds, ink: (x: number, y: number) => boolean, minArea: number) {
  return [...labelComponents(bounds, (x, y) => ink(x, y) ? null : true)]
    .filter((hole) => insideBounds(hole, bounds) && hole.area > minArea)
}

export function insideBounds(component: Bounds, bounds: Bounds): boolean {
  return component.minX > bounds.minX && component.maxX < bounds.maxX &&
    component.minY > bounds.minY && component.maxY < bounds.maxY
}

export function labelPixelSet(
  pixels: ReadonlySet<string>,
): (Component<true> & { points: [number, number][] })[] {
  const unseen = new Set(pixels)
  const components: (Component<true> & { points: [number, number][] })[] = []
  for (const key of unseen) {
    const [x, y] = key.split(',').map(Number)
    unseen.delete(key)
    const points: [number, number][] = []
    const claim = (nextX: number, nextY: number): boolean => unseen.delete(`${nextX},${nextY}`)
    const component = floodComponent<true>(x, y, true, claim, 1, (px, py) => points.push([px, py]))
    components.push({ ...component, points })
  }
  return components
}

function floodComponent<Label>(
  startX: number,
  startY: number,
  label: Label,
  claim: (x: number, y: number) => boolean,
  step: number,
  visit?: (x: number, y: number) => void,
): Component<Label> {
  const stack: [number, number][] = [[startX, startY]]
  let area = 0
  let sumX = 0
  let sumY = 0
  let minX = startX
  let maxX = startX
  let minY = startY
  let maxY = startY
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    const [x, y] = current
    area += 1
    sumX += x
    sumY += y
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    visit?.(x, y)
    for (const [dx, dy] of neighbors) {
      const nextX = x + dx * step
      const nextY = y + dy * step
      if (claim(nextX, nextY)) stack.push([nextX, nextY])
    }
  }
  return { label, area, x: sumX / area, y: sumY / area, minX, maxX, minY, maxY }
}
