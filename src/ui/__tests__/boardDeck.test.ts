import { describe, expect, it } from 'vitest'
import { MIN_DECK_BOARD_HEIGHT, clampDeckBoardHeight, deckBoardCeiling } from '../boardDeck'

// Every expectation here is a literal on purpose: written against the constants
// they would move with, these tests stay green while the floor triples and
// squeezes the panel below the board off screen.
describe('clampDeckBoardHeight', () => {
  it('leaves a comfortable height untouched', () => {
    expect(clampDeckBoardHeight(360, 844, 180)).toBe(360)
  })

  it('never shrinks below the floor', () => {
    expect(MIN_DECK_BOARD_HEIGHT).toBe(120)
    expect(clampDeckBoardHeight(10, 844, 180)).toBe(120)
    expect(clampDeckBoardHeight(-500, 844, 180)).toBe(120)
  })

  it('keeps the deck chrome the measured reserve paid for on screen', () => {
    expect(clampDeckBoardHeight(9000, 844, 180)).toBe(664)
    expect(clampDeckBoardHeight(9000, 844, 250)).toBe(594)
  })

  it('prefers the floor over the ceiling on viewports too short for both', () => {
    // 300px of viewport leaves 120px once the chrome is reserved, at the floor;
    // 60px less viewport would leave a sliver, so the floor takes over.
    expect(clampDeckBoardHeight(9000, 300, 180)).toBe(120)
    expect(clampDeckBoardHeight(9000, 240, 180)).toBe(120)
    expect(clampDeckBoardHeight(10, 240, 180)).toBe(120)
  })

  it('prefers the floor when the chrome alone outgrows the viewport', () => {
    // Both arguments come from the caller, and nothing here relates them: this
    // is a defensive bound, not a state the shell is known to reach. The
    // subtraction goes negative and the floor still wins.
    expect(clampDeckBoardHeight(9000, 400, 900)).toBe(120)
    expect(clampDeckBoardHeight(360, 400, 900)).toBe(120)
  })

  it('ignores a viewport height it cannot trust', () => {
    expect(clampDeckBoardHeight(300, 0, 180)).toBe(120)
  })
})

describe('deckBoardCeiling', () => {
  it('reserves the measured chrome from the viewport', () => {
    expect(deckBoardCeiling(844, 180)).toBe(664)
    expect(deckBoardCeiling(664, 172)).toBe(492)
  })

  it('never reports a ceiling under the floor', () => {
    expect(deckBoardCeiling(300, 250)).toBe(120)
    expect(deckBoardCeiling(0, 180)).toBe(120)
    expect(deckBoardCeiling(400, 900)).toBe(120)
  })

  it('gives the board the whole viewport before the chrome is measured', () => {
    // A reserve of zero is the shipping first-render state, and the standing one
    // in landscape, where the measurement bails rather than store a figure taken
    // from a hidden handle.
    expect(deckBoardCeiling(844, 0)).toBe(844)
    expect(deckBoardCeiling(0, 0)).toBe(120)
  })
})

