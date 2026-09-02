import { describe, expect, it } from 'vitest'
import { shouldRevealBoard } from '../revealBoard'

describe('shouldRevealBoard', () => {
  it('reveals once the board has scrolled under the header', () => {
    expect(shouldRevealBoard(-200, 46)).toBe(true)
    expect(shouldRevealBoard(100, 46)).toBe(true)
  })

  it('leaves the page alone while enough of the board is still on screen', () => {
    expect(shouldRevealBoard(166, 46)).toBe(false)
    expect(shouldRevealBoard(500, 46)).toBe(false)
  })
})
