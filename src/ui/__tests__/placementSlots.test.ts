import { describe, expect, it } from 'vitest'
import { clickTarget, nearestTarget, nextBuildingTier } from '../placementSlots'

const targets = [
  { ref: 'a', x: 0, y: 0 },
  { ref: 'b', x: 29, y: 0 },
  { ref: 'c', x: 58, y: 0 },
]

describe('nearestTarget', () => {
  it('returns the closest target to the point', () => {
    expect(nearestTarget({ x: 10, y: 4 }, targets, 29)).toBe('a')
    expect(nearestTarget({ x: 20, y: -4 }, targets, 29)).toBe('b')
    expect(nearestTarget({ x: 50, y: 10 }, targets, 29)).toBe('c')
  })

  it('reaches exactly as far as the cap and no further', () => {
    expect(nearestTarget({ x: 0, y: 29 }, targets, 29)).toBe('a')
    expect(nearestTarget({ x: 0, y: 29.5 }, targets, 29)).toBeNull()
  })

  it('lets a target take the room a missing neighbour leaves', () => {
    const withoutB = targets.filter((target) => target.ref !== 'b')
    expect(nearestTarget({ x: 20, y: 0 }, targets, 29)).toBe('b')
    expect(nearestTarget({ x: 20, y: 0 }, withoutB, 29)).toBe('a')
  })

  it('returns null with nothing to hit', () => {
    expect(nearestTarget({ x: 0, y: 0 }, [], 29)).toBeNull()
  })
})

describe('clickTarget', () => {
  const reach = { max: 29, repeat: 10, direct: 8 }
  // The first click at (20, 0) landed on `a` while `b` was not yet a target.
  const previous = { ref: 'a', x: 20, y: 0 }

  it('takes the nearest target when there is no previous click', () => {
    expect(clickTarget({ x: 20, y: 0 }, targets, null, reach)).toBe('b')
  })

  it('keeps a repeat click on the previous target although a nearer one has appeared', () => {
    expect(clickTarget({ x: 20, y: 0 }, targets, previous, reach)).toBe('a')
    expect(clickTarget({ x: 20, y: 10 }, targets, previous, reach)).toBe('a')
  })

  it('does nothing on a repeat click whose target is gone, rather than hitting a neighbour', () => {
    const withoutA = targets.filter((target) => target.ref !== 'a')
    expect(clickTarget({ x: 20, y: 0 }, withoutA, previous, reach)).toBeNull()
  })

  it('goes back to the nearest target once the click moves past the repeat distance', () => {
    expect(clickTarget({ x: 20, y: 11 }, targets, previous, reach)).toBe('b')
  })

  it('acts on another target the click lands right on, even within the repeat distance', () => {
    expect(clickTarget({ x: 24, y: 0 }, targets, previous, reach)).toBe('b')
    expect(clickTarget({ x: 21, y: 0 }, targets, previous, reach)).toBe('b')
    expect(clickTarget({ x: 20.5, y: 0 }, targets, previous, reach)).toBe('a')
  })
})

describe('nextBuildingTier', () => {
  const all = { city: true, superCity: false }

  it('cycles an empty corner to a settlement, a city, then nothing', () => {
    expect(nextBuildingTier(undefined, all)).toBe('settlement')
    expect(nextBuildingTier('settlement', all)).toBe('city')
    expect(nextBuildingTier('city', all)).toBeNull()
  })

  it('adds the super city after the city only when allowed', () => {
    expect(nextBuildingTier('city', { city: true, superCity: true })).toBe('superCity')
    expect(nextBuildingTier('superCity', { city: true, superCity: true })).toBeNull()
    expect(nextBuildingTier('superCity', all)).toBeNull()
  })

  it('skips the city while the draft is in progress', () => {
    const drafting = { city: false, superCity: false }
    expect(nextBuildingTier(undefined, drafting)).toBe('settlement')
    expect(nextBuildingTier('settlement', drafting)).toBeNull()
  })
})
