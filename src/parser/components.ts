interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface Component<Label> extends Bounds {
  label: Label
  area: number
  x: number
  y: number
}

interface LabelOptions {
  step?: number
  discardAdjacent?: boolean
  visit?: (x: number, y: number) => void
}

const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function* labelComponents<Label>(
  bounds: Bounds,
  classify: (x: number, y: number) => Label | null,
  { step = 1, discardAdjacent = false, visit }: LabelOptions = {},
): Generator<Component<Label>> {
  const { minX, maxX, minY, maxY } = bounds
  const width = maxX - minX + 1
  const seen = new Uint8Array(width * Math.max(0, maxY - minY + 1))
  const index = (x: number, y: number) => (y - minY) * width + x - minX
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (seen[index(x, y)]) continue
      const label = classify(x, y)
      seen[index(x, y)] = 1
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

export function labelPixelSet(
  pixels: ReadonlySet<string>,
  bounds?: Bounds,
): (Component<true> & { points: [number, number][] })[] {
  const unseen = new Set(pixels)
  const components: (Component<true> & { points: [number, number][] })[] = []
  for (const key of unseen) {
    const [x, y] = key.split(',').map(Number)
    unseen.delete(key)
    const points: [number, number][] = []
    const claim = (nextX: number, nextY: number): boolean => {
      if (bounds && (nextX < bounds.minX || nextX > bounds.maxX ||
        nextY < bounds.minY || nextY > bounds.maxY)) return false
      return unseen.delete(`${nextX},${nextY}`)
    }
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
