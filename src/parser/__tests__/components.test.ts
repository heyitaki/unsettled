import { describe, expect, it } from 'vitest'
import { labelComponents, labelPixelSet } from '../components'

describe('component traversal', () => {
  it('preserves tile boundary rejection and row-major component order', () => {
    const bounds = { minX: 0, maxX: 3, minY: 0, maxY: 0 }
    const classify = (x: number) => ['wood', 'brick', 'brick', 'wood'][x]
    const components = [...labelComponents(bounds, classify, { discardAdjacent: true })]
    expect(components.map(({ label, area, x }) => ({ label, area, x }))).toEqual([
      { label: 'wood', area: 1, x: 0 },
      { label: 'brick', area: 1, x: 2 },
    ])
    expect([...labelComponents(bounds, classify)].map(({ label, area }) => ({ label, area }))).toEqual([
      { label: 'wood', area: 1 },
      { label: 'brick', area: 2 },
      { label: 'wood', area: 1 },
    ])
  })

  it('keeps the sampling phase, centroid and bounds on a two-pixel grid', () => {
    const bounds = { minX: 0, maxX: 4, minY: 3, maxY: 5 }
    const components = [...labelComponents(bounds, (x, y) => x <= 2 && y % 2 === 1 ? true : null, { step: 2 })]
    expect(components).toEqual([
      { label: true, area: 4, x: 1, y: 4, minX: 0, maxX: 2, minY: 3, maxY: 5 },
    ])
  })

  it('keeps Set seed order and depth-first pixel order without joining diagonals', () => {
    const pixels = new Set(['9,9', '1,1', '2,1', '1,2', '2,2', '3,3'])
    const components = labelPixelSet(pixels)
    expect(components.map((component) => component.points)).toEqual([
      [[9, 9]],
      [[1, 1], [1, 2], [2, 2], [2, 1]],
      [[3, 3]],
    ])
    expect(components[1]).toMatchObject({ area: 4, x: 1.5, y: 1.5, minX: 1, maxX: 2, minY: 1, maxY: 2 })
    expect([...pixels]).toEqual(['9,9', '1,1', '2,1', '1,2', '2,2', '3,3'])
  })
})
