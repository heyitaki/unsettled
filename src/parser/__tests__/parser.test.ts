import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseBoard } from '../../model/serialization'
import type { Board } from '../../model/types'
import { parseScreenshot } from '../index'
import { colored, load, sorted, toSrgb } from './pillPixels'

import expectedTwo from './expected/settled-2p-first-pick.json'
import expectedThree from './expected/settled-3p-pick-cards.json'
import expectedFive from './expected/settled-5p-draft-start.json'
import expectedFiveMidgame from './expected/settled-5p-midgame-hand.json'
import expectedEndgame from './expected/board-endgame-pieces.json'
import endgameRoadOrder from './expected/board-endgame-road-order.json'

function image(path: string) {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(path, import.meta.url))))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

describe('screenshot parser', () => {
  it.each([
    ['settled-2p-first-pick', expectedTwo],
    ['settled-3p-pick-cards', expectedThree],
    ['settled-5p-draft-start', expectedFive],
    // The Ore card in the hand has the mountain tiles' colour and size.
    ['settled-5p-midgame-hand', expectedFiveMidgame],
  ])('parses %s into the pinned board in draft order', (name, expected) => {
    const result = parseScreenshot(image(`../../../fixtures/${name}.png`))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parseBoard(result.game.board).ok).toBe(true)
    expect(result.game.board).toEqual(expected)
    expect(result.issues).toEqual([])
  })

  it.each([
    ['raw', '../../../fixtures/board-endgame-pieces.png'],
    ['sRGB', './derived/board-endgame-pieces.srgb.png'],
  ])('preserves the %s endgame board with a roster synthesized from pieces', (_name, path) => {
    const result = parseScreenshot(image(path))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const board = result.game.board
    const expected = expectedEndgame as Board
    expect(parseBoard(board).ok).toBe(true)
    expect(board.hexes).toEqual(expected.hexes)
    expect(sorted(board.ports)).toEqual(sorted(expected.ports))
    expect(board.robber).toEqual(expected.robber)

    // Road insertion order breaks Longest Road ties.
    const expectedRoads = endgameRoadOrder.map((edgeId) => expected.roads.find((road) => road.edgeId === edgeId)!)
    expect(colored(board, board.roads)).toEqual(colored(expected, expectedRoads))
    expect(sorted(colored(board, board.buildings))).toEqual(sorted(colored(expected, expected.buildings)))
    expect(board.mePlayerId).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'roster', message: 'Roster was synthesized from detected pieces' }))
  })

  it('parses converted sRGB pills, counters and pieces like the raw screenshot', () => {
    const raw = parseScreenshot(load())
    const converted = parseScreenshot(toSrgb(load()))
    expect(raw.ok).toBe(true)
    expect(converted.ok).toBe(true)
    if (!raw.ok || !converted.ok) return
    expect(converted.game).toEqual(raw.game)
    expect(converted.issues).toEqual([])
  })

  it('infers the robber-occluded endgame token from the distribution', () => {
    const result = parseScreenshot(image('../../../fixtures/board-endgame-pieces.png'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.filter((issue) => issue.severity === 'unreadable')).toEqual([])
    const occluded = result.game.board.hexes.find((hex) => hex.coord.q === -3 && hex.coord.r === 1)
    expect(occluded?.numberToken).toBe(6)
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'tokens', ref: '-3,1', severity: 'warning' }))
  })
})
