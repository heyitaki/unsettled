import { describe, expect, it } from 'vitest'
import { clampToViewport, placeBelow } from '../overlayPosition'

const viewport = { width: 1000, height: 800 }

describe('clampToViewport', () => {
  it('returns the requested point when the popup fits there', () => {
    expect(clampToViewport(120, 240, { width: 200, height: 150 }, viewport)).toEqual({ left: 120, top: 240 })
  })

  it('pulls the popup back inside on right and bottom overflow', () => {
    // Default margin is 4, matching what ContextMenu used inline.
    expect(clampToViewport(950, 100, { width: 200, height: 150 }, viewport).left).toBe(796)
    expect(clampToViewport(100, 780, { width: 200, height: 150 }, viewport).top).toBe(646)
  })

  it('never places the popup above or left of the margin', () => {
    expect(clampToViewport(-50, -50, { width: 200, height: 150 }, viewport)).toEqual({ left: 4, top: 4 })
  })

  it('keeps the near edge visible when the popup is larger than the viewport', () => {
    // The clamp that would push it off the top loses to the margin floor, so a
    // too-tall menu starts on screen and overflows downward instead.
    expect(clampToViewport(10, 10, { width: 1200, height: 900 }, viewport)).toEqual({ left: 4, top: 4 })
  })

  it('honours an explicit margin', () => {
    expect(clampToViewport(990, 5, { width: 200, height: 150 }, viewport, 12)).toEqual({ left: 788, top: 12 })
  })
})

describe('placeBelow', () => {
  const size = { width: 160, height: 200 }

  it('sits under the trigger when there is room', () => {
    const trigger = { left: 40, top: 100, bottom: 130 }
    expect(placeBelow(trigger, size, viewport)).toEqual({ left: 40, top: 130, flipped: false })
  })

  it('flips above the trigger when the popup is taller than the space below', () => {
    const trigger = { left: 40, top: 640, bottom: 670 }
    expect(placeBelow(trigger, size, viewport)).toEqual({ left: 40, top: 440, flipped: true })
  })

  it('stays below when flipping would only make it worse, and clamps instead', () => {
    // Taller than the space below, but the space above is smaller still.
    const trigger = { left: 40, top: 120, bottom: 150 }
    const tall = { width: 160, height: 700 }
    expect(placeBelow(trigger, tall, viewport)).toEqual({ left: 40, top: 96, flipped: false })
  })

  it('clamps horizontally like any other overlay', () => {
    const trigger = { left: 960, top: 100, bottom: 130 }
    expect(placeBelow(trigger, size, viewport)).toEqual({ left: 836, top: 130, flipped: false })
  })
})
