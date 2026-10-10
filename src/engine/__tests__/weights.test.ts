import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, SEAT_WEIGHT_OVERRIDES, WEIGHT_SEATS, weightsForSeats } from '../weights'

// The simulator reads its own copy of the app's defaults rather than importing
// TypeScript, so `simulator/placement/default-weights.json` is a hand-maintained
// mirror with nothing else tying it to `DEFAULT_WEIGHTS`. Nothing downstream
// catches drift: the placement-parity fixture embeds the weights it was
// generated with, so it proves Rust matches *that snapshot*, never that the
// snapshot still matches the app. Drift therefore leaves every simulator arm
// silently scoring against a field that is not the app, with every suite green.
const mirrorPath = new URL('../../../simulator/placement/default-weights.json', import.meta.url)

describe('simulator weights mirror', () => {
  it('matches DEFAULT_WEIGHTS exactly', () => {
    const mirror: unknown = JSON.parse(readFileSync(mirrorPath, 'utf8'))
    expect(mirror).toEqual(DEFAULT_WEIGHTS)
  })

  it.each(WEIGHT_SEATS)('matches weightsForSeats(%i) exactly', (seats) => {
    const path = new URL(`../../../simulator/placement/seat-weights/seats-${seats}.json`, import.meta.url)
    const mirror: unknown = JSON.parse(readFileSync(path, 'utf8'))
    expect(mirror).toEqual(weightsForSeats(seats))
  })
})

describe('seat-count weights', () => {
  it.each([1, 7])('falls back to DEFAULT_WEIGHTS for %i seats', (seats) => {
    expect(weightsForSeats(seats)).toEqual(DEFAULT_WEIGHTS)
  })

  it.each(WEIGHT_SEATS)('merges the overrides for %i seats', (seats) => {
    expect(weightsForSeats(seats)).toEqual({ ...DEFAULT_WEIGHTS, ...SEAT_WEIGHT_OVERRIDES[seats] })
  })
})
