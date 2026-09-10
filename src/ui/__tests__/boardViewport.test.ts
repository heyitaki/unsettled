import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  clampTransform,
  clientToUnits,
  panBy,
  transformedViewBox,
  zoomAbout,
  type Box,
  type ViewTransform,
} from '../boardViewport'

// A stand-in for BoardCanvas's fitted viewBox: origin off zero, because tx/ty
// are offsets from the base origin rather than absolute board coordinates.
const base: Box = { x: -40, y: -30, width: 600, height: 400 }

// The inverse of clientToUnits, written out here so the round-trip test states
// the projection it expects: xMidYMid meet, the SVG default the board renders
// under once max-height letterboxes it.
const unitsToClient = (
  point: { x: number; y: number },
  rect: Box,
  box: Box,
  transform: ViewTransform,
) => {
  const view = transformedViewBox(box, transform)
  const scale = Math.min(rect.width / view.width, rect.height / view.height)
  return {
    x: rect.x + (rect.width - view.width * scale) / 2 + (point.x - view.x) * scale,
    y: rect.y + (rect.height - view.height * scale) / 2 + (point.y - view.y) * scale,
  }
}

describe('clampTransform', () => {
  it('pins the board to its own sea at scale 1', () => {
    expect(clampTransform({ scale: 1, tx: 250, ty: -80 }, base)).toEqual(IDENTITY)
  })

  it('bounds the scale to [1, 6]', () => {
    expect(clampTransform({ scale: 0.2, tx: 0, ty: 0 }, base).scale).toBe(1)
    expect(clampTransform({ scale: 99, tx: 0, ty: 0 }, base).scale).toBe(6)
  })

  it('keeps the visible window inside the base box at every edge', () => {
    expect(clampTransform({ scale: 2, tx: -50, ty: -50 }, base)).toEqual({ scale: 2, tx: 0, ty: 0 })
    expect(clampTransform({ scale: 2, tx: 999, ty: 999 }, base)).toEqual({ scale: 2, tx: 300, ty: 200 })
  })
})

describe('transformedViewBox', () => {
  it('is the base box under the identity transform', () => {
    expect(transformedViewBox(base, IDENTITY)).toEqual(base)
  })

  it('shrinks the window by the scale and offsets it by tx/ty', () => {
    expect(transformedViewBox(base, { scale: 2, tx: 100, ty: 60 })).toEqual({
      x: 60, y: 30, width: 300, height: 200,
    })
  })
})

describe('panBy', () => {
  it('moves the window by the given board-unit delta', () => {
    expect(panBy({ scale: 2, tx: 0, ty: 0 }, 50, 30, base)).toEqual({ scale: 2, tx: 50, ty: 30 })
  })

  it('clamps at every edge', () => {
    expect(panBy({ scale: 2, tx: 280, ty: 190 }, 100, 100, base)).toEqual({ scale: 2, tx: 300, ty: 200 })
    expect(panBy({ scale: 2, tx: 20, ty: 10 }, -100, -100, base)).toEqual({ scale: 2, tx: 0, ty: 0 })
  })

  it('cannot pan an unzoomed board', () => {
    expect(panBy(IDENTITY, 120, 90, base)).toEqual(IDENTITY)
  })
})

describe('zoomAbout', () => {
  const square: Box = { x: 0, y: 0, width: 600, height: 400 }
  const zoomed: ViewTransform = { scale: 2, tx: 100, ty: 60 }
  const anchor = { x: 220, y: 140 }
  // Where the anchor sits inside the visible window, as a fraction of it. That
  // fraction is what a pinch must leave alone.
  const fraction = (transform: ViewTransform) => {
    const view = transformedViewBox(square, transform)
    return { x: (anchor.x - view.x) / view.width, y: (anchor.y - view.y) / view.height }
  }

  it('leaves the anchor point stationary', () => {
    const before = fraction(zoomed)
    const after = fraction(zoomAbout(zoomed, 1.5, anchor, square))
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  })

  it('round-trips a zoom in and back out about the same point', () => {
    const there = zoomAbout(zoomed, 1.5, anchor, square)
    const back = zoomAbout(there, 1 / 1.5, anchor, square)
    expect(back.scale).toBeCloseTo(zoomed.scale, 10)
    expect(back.tx).toBeCloseTo(zoomed.tx, 10)
    expect(back.ty).toBeCloseTo(zoomed.ty, 10)
  })

  it('returns to the identity when zoomed all the way out', () => {
    expect(zoomAbout(zoomed, 0.1, anchor, square)).toEqual(IDENTITY)
  })

  it('bounds the scale at 6', () => {
    expect(zoomAbout({ scale: 5, tx: 0, ty: 0 }, 4, anchor, square).scale).toBe(6)
  })

  it('clamps the window when the anchor sits on the board edge', () => {
    expect(zoomAbout(IDENTITY, 2, { x: 600, y: 400 }, square)).toEqual({ scale: 2, tx: 300, ty: 200 })
  })
})

describe('clientToUnits', () => {
  it('maps the element box onto the viewBox when their aspect ratios match', () => {
    const rect: Box = { x: 0, y: 0, width: 300, height: 200 }
    const square: Box = { x: 0, y: 0, width: 600, height: 400 }
    expect(clientToUnits({ x: 0, y: 0 }, rect, square, IDENTITY)).toEqual({ x: 0, y: 0 })
    expect(clientToUnits({ x: 150, y: 100 }, rect, square, IDENTITY)).toEqual({ x: 300, y: 200 })
    expect(clientToUnits({ x: 300, y: 200 }, rect, square, IDENTITY)).toEqual({ x: 600, y: 400 })
  })

  it('accounts for the letterboxing a short element box produces', () => {
    // 400x200 element, 600x400 viewBox: the content renders 300x200, centred,
    // so 50px of the element's width on each side is bare sea, not board.
    const rect: Box = { x: 10, y: 20, width: 400, height: 200 }
    const square: Box = { x: 0, y: 0, width: 600, height: 400 }
    expect(clientToUnits({ x: 60, y: 20 }, rect, square, IDENTITY)).toEqual({ x: 0, y: 0 })
    expect(clientToUnits({ x: 210, y: 120 }, rect, square, IDENTITY)).toEqual({ x: 300, y: 200 })
    expect(clientToUnits({ x: 360, y: 220 }, rect, square, IDENTITY)).toEqual({ x: 600, y: 400 })
  })

  it('round-trips against transformedViewBox under a live transform', () => {
    const rect: Box = { x: 5, y: 7, width: 450, height: 200 }
    const transform: ViewTransform = { scale: 2, tx: 100, ty: 60 }
    for (const units of [{ x: 60, y: 30 }, { x: 120, y: 90 }, { x: 360, y: 230 }]) {
      const client = unitsToClient(units, rect, base, transform)
      const back = clientToUnits(client, rect, base, transform)
      expect(back.x).toBeCloseTo(units.x, 10)
      expect(back.y).toBeCloseTo(units.y, 10)
    }
  })

  it('answers with the window centre for a zero-sized element box', () => {
    // A gesture that arrives before layout must not poison the transform with NaN.
    const rect: Box = { x: 0, y: 0, width: 0, height: 0 }
    expect(clientToUnits({ x: 12, y: 12 }, rect, base, IDENTITY)).toEqual({ x: 260, y: 170 })
  })
})
