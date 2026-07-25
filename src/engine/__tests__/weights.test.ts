import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS } from '../weights'

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
})
