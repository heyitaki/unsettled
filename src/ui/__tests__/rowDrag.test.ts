import { describe, expect, it } from 'vitest'
import { dropIndexFor, edgeScrollStep } from '../rowDrag'

const rows = [
  { top: 0, bottom: 40 },
  { top: 40, bottom: 80 },
  { top: 80, bottom: 120 },
]

describe('dropIndexFor', () => {
  it('takes the row under the pointer, not the gap before it', () => {
    expect(dropIndexFor(rows, 5)).toBe(0)
    expect(dropIndexFor(rows, 21)).toBe(0)
    expect(dropIndexFor(rows, 39)).toBe(0)
    expect(dropIndexFor(rows, 41)).toBe(1)
    expect(dropIndexFor(rows, 61)).toBe(1)
    expect(dropIndexFor(rows, 100)).toBe(2)
  })

  it('hands a row over at its bottom edge', () => {
    expect(dropIndexFor(rows, 40)).toBe(1)
    expect(dropIndexFor(rows, 80)).toBe(2)
  })

  it('clamps past either end', () => {
    expect(dropIndexFor(rows, -500)).toBe(0)
    expect(dropIndexFor(rows, 5000)).toBe(2)
  })

  it('has no target in an empty list', () => {
    expect(dropIndexFor([], 10)).toBe(0)
  })
})

describe('edgeScrollStep', () => {
  it('stays still away from either edge', () => {
    expect(edgeScrollStep(400, 800)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom', () => {
    expect(edgeScrollStep(10, 800)).toBeLessThan(0)
    expect(edgeScrollStep(790, 800)).toBeGreaterThan(0)
  })

  it('accelerates towards the edge', () => {
    expect(Math.abs(edgeScrollStep(5, 800))).toBeGreaterThan(Math.abs(edgeScrollStep(60, 800)))
    expect(edgeScrollStep(795, 800)).toBeGreaterThan(edgeScrollStep(740, 800))
  })

  // Literal magnitudes, never the module's own constants: these are the only
  // assertions that catch a retuned speed, a resized margin, or a rounding
  // change that silently stops the scroll just inside the margin.
  it('tops out at 15px a frame and no more past the edge', () => {
    expect(edgeScrollStep(0, 800)).toBe(-15)
    expect(edgeScrollStep(-9000, 800)).toBe(-15)
    expect(edgeScrollStep(800, 800)).toBe(15)
    expect(edgeScrollStep(9000, 800)).toBe(15)
  })

  it('ramps to full speed over a 76px margin', () => {
    expect(edgeScrollStep(38, 800)).toBe(-8)
    expect(edgeScrollStep(762, 800)).toBe(8)
  })

  it('still crawls one pixel a frame at the shallowest point of the margin', () => {
    // Rounds up, or the outermost pixels of the margin would not scroll at all.
    expect(edgeScrollStep(75, 800)).toBe(-1)
    expect(edgeScrollStep(725, 800)).toBe(1)
  })

  it('stops exactly at the margin', () => {
    expect(edgeScrollStep(76, 800)).toBe(0)
    expect(edgeScrollStep(724, 800)).toBe(0)
  })

  it('gives up on a viewport too short to hold both margins', () => {
    expect(edgeScrollStep(50, 100)).toBe(0)
  })
})
