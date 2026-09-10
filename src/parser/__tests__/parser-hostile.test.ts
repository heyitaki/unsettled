import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseBoard } from '../../model/serialization'
import { parseEdgeId } from '../../model/coords'
import { boardGrid, defaultPortEdges } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { parseScreenshot, type RgbaImage, type SourceParse } from '../index'
import { nearColor, pixel, type Rgb } from '../image'
import type { ParserPalette } from '../palette'
import { registerBoard } from '../registration'
import { choosePalette } from '../sources/settled/palette'
import expectedDraft from './expected/board-draft-empty.json'
import expectedEndgame from './expected/board-endgame-pieces.json'

function load(path = '../../../fixtures/board-draft-empty.png'): RgbaImage {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(path, import.meta.url))))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

function nearestHalf(img: RgbaImage): RgbaImage {
  const width = Math.floor(img.width / 2)
  const height = Math.floor(img.height / 2)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((y * 2) * img.width + x * 2) * 4
      data.set(img.data.subarray(source, source + 4), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function bilinear(img: RgbaImage, factor: number): RgbaImage {
  const width = Math.floor(img.width / factor)
  const height = Math.floor(img.height / factor)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, (x + 0.5) * factor - 0.5)
      const sourceY = Math.max(0, (y + 0.5) * factor - 0.5)
      const x0 = Math.floor(sourceX)
      const y0 = Math.floor(sourceY)
      const x1 = Math.min(img.width - 1, x0 + 1)
      const y1 = Math.min(img.height - 1, y0 + 1)
      const fx = sourceX - x0
      const fy = sourceY - y0
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + channel]
        const p10 = img.data[(y0 * img.width + x1) * 4 + channel]
        const p01 = img.data[(y1 * img.width + x0) * 4 + channel]
        const p11 = img.data[(y1 * img.width + x1) * 4 + channel]
        data[(y * width + x) * 4 + channel] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
    }
  }
  return { width, height, data }
}

const sorted = <T extends object>(values: T[]) => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

function assertStableBoard(actual: Board, expected: Board) {
  expect(actual.hexes.map((hex) => ({ coord: hex.coord, tile: hex.tile }))).toEqual(
    expected.hexes.map((hex) => ({ coord: hex.coord, tile: hex.tile })),
  )
  expect(sorted(actual.ports)).toEqual(sorted(expected.ports))
  expect(actual.players.map((player) => player.color)).toEqual(expected.players.map((player) => player.color))
  expect(actual.robber).toEqual(expected.robber)
  expect(sorted(actual.roads)).toEqual(sorted(expected.roads))
  expect(sorted(actual.buildings)).toEqual(sorted(expected.buildings))
}

function expectSchemaValid(result: SourceParse): result is Extract<SourceParse, { ok: true }> {
  expect(result.ok).toBe(true)
  if (!result.ok) return false
  expect(parseBoard(result.game.board).ok).toBe(true)
  return true
}

function assertNullTokensFlagged(result: Extract<SourceParse, { ok: true }>) {
  for (const hex of result.game.board.hexes.filter((candidate) =>
    candidate.tile !== 'desert' && candidate.numberToken === null)) {
    const ref = `${hex.coord.q},${hex.coord.r}`
    expect(result.issues.some((issue) =>
      issue.stage === 'tokens' && issue.ref === ref &&
      (issue.severity === 'unreadable' || issue.message.toLowerCase().includes('review')),
    )).toBe(true)
  }
}

const expectedEndgameStats = {
  p1: { handUnknown: 12, devCards: 0, knights: 1, vpCards: 0 },
  p2: { handUnknown: 4, devCards: 5, knights: 0, vpCards: 3 },
  p3: { handUnknown: 12, devCards: 0, knights: 0, vpCards: 0 },
  p4: { handUnknown: 3, devCards: 0, knights: 1, vpCards: 0 },
  p5: { handUnknown: 6, devCards: 2, knights: 3, vpCards: 2 },
} as const

function assertStatsNeverGuess(result: Extract<SourceParse, { ok: true }>) {
  for (const [playerId, expected] of Object.entries(expectedEndgameStats)) {
    const actual = result.game.stats[playerId]
    for (const key of ['handUnknown', 'devCards', 'knights', 'vpCards'] as const) {
      if (expected[key] === 0) {
        expect(actual[key]).toBe(0)
      } else if (actual[key] === 0) {
        expect(result.issues).toContainEqual(expect.objectContaining({
          stage: 'stats',
          severity: 'unreadable',
          ref: `${playerId}.${key}`,
        }))
      } else {
        expect(actual[key]).toBe(expected[key])
      }
    }
  }
}

function withSecondRobberCandidate(image: RgbaImage): RgbaImage {
  const palette = fixturePalette(image)
  const registration = registerBoard(image, palette)
  if (!registration) throw new Error('fixture registration not found')
  const [centerX, centerY] = registration.center({ q: 0, r: -3 })
  const radius = 0.16 * registration.size
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      if (Math.hypot(x - centerX, y - centerY) > radius) continue
      const index = (y * image.width + x) * 4
      result.data[index] = 26
      result.data[index + 1] = 26
      result.data[index + 2] = 26
      result.data[index + 3] = 255
    }
  }
  return result
}

function withAmbiguousPill(image: RgbaImage): RgbaImage {
  const palette = fixturePalette(image)
  const registration = registerBoard(image, palette)
  if (!registration) throw new Error('fixture registration not found')
  const used = new Set(defaultPortEdges(registration.layout))
  const edges = boardGrid(registration.layout).coastalEdgeIds.map((edgeId) => {
    const centers = parseEdgeId(edgeId).map(registration.center)
    return {
      edgeId,
      x: (centers[0][0] + centers[1][0]) / 2,
      y: (centers[0][1] + centers[1][1]) / 2,
    }
  })
  let best: { x: number; y: number; score: number } | null = null
  for (let y = registration.bandTop + 35; y < registration.bandBottom - 35; y += 2) {
    for (let x = 60; x < image.width - 60; x += 2) {
      const outside = registration.tiles.every((tile) => {
        const [centerX, centerY] = registration.center(tile)
        return Math.hypot(x - centerX, y - centerY) > 1.15 * registration.size
      })
      if (!outside || Math.hypot(x - 409, y - 1059) < 150) continue
      let nearbyCream = 0
      for (let sampleY = y - 25; sampleY <= y + 25; sampleY += 10) {
        for (let sampleX = x - 50; sampleX <= x + 50; sampleX += 10) {
          if (nearColor(pixel(image, sampleX, sampleY), palette.tokenCream, 18)) nearbyCream += 1
        }
      }
      if (nearbyCream > 0) continue
      const ranked = edges.map((edge) => ({
        ...edge,
        distance: Math.hypot(edge.x - x, edge.y - y),
      })).sort((a, b) => a.distance - b.distance)
      if (used.has(ranked[0].edgeId) || ranked[0].distance < 35 || ranked[0].distance > 130) continue
      const score = Math.abs(ranked[1].distance / ranked[0].distance - 1)
      if (!best || score < best.score) best = { x, y, score }
    }
  }
  if (!best || best.score >= 0.03) throw new Error('ambiguous target not found')
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  const sourceX = 354
  const sourceY = 1029
  const width = 110
  const height = 60
  const targetX = Math.round(best.x - width / 2)
  const targetY = Math.round(best.y - height / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((sourceY + y) * image.width + sourceX + x) * 4
      const target = ((targetY + y) * image.width + targetX + x) * 4
      result.data.set(image.data.subarray(source, source + 4), target)
    }
  }
  return result
}

function withDuplicateEdgePill(image: RgbaImage): RgbaImage {
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  const sourceX = 354
  const sourceY = 1029
  const width = 110
  const height = 60
  const targetX = 314
  const targetY = 929
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((sourceY + y) * image.width + sourceX + x) * 4
      const target = ((targetY + y) * image.width + targetX + x) * 4
      result.data.set(image.data.subarray(source, source + 4), target)
    }
  }
  return result
}

// Erases roster slots by tiling the clear column beside each across it, so a
// slot carries the screenshot's own background rather than a colour picked here.
function withoutSlots(
  image: RgbaImage,
  { top, bottom }: { top: number; bottom: number },
  slots: { gutterX: number; fromX: number; toX: number }[],
): RgbaImage {
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  for (const { gutterX, fromX, toX } of slots) {
    for (let y = top; y < bottom; y += 1) {
      const source = (y * image.width + gutterX) * 4
      for (let x = fromX; x < Math.min(toX, image.width); x += 1) {
        result.data.set(image.data.subarray(source, source + 4), (y * image.width + x) * 4)
      }
    }
  }
  return result
}

// Paints flat discs of a player colour, the shape both a header badge and a
// stray blob inside the roster row present to the dot detector.
function withStampedDots(
  image: RgbaImage,
  dots: { x: number; y: number; radius: number; color: Rgb }[],
): RgbaImage {
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  for (const dot of dots) {
    for (let y = Math.floor(dot.y - dot.radius); y <= Math.ceil(dot.y + dot.radius); y += 1) {
      for (let x = Math.floor(dot.x - dot.radius); x <= Math.ceil(dot.x + dot.radius); x += 1) {
        if (Math.hypot(x - dot.x, y - dot.y) > dot.radius) continue
        const index = (y * image.width + x) * 4
        result.data[index] = dot.color[0]
        result.data[index + 1] = dot.color[1]
        result.data[index + 2] = dot.color[2]
        result.data[index + 3] = 255
      }
    }
  }
  return result
}

function fixturePalette(image: RgbaImage): ParserPalette {
  const palette = choosePalette(image)
  if (!palette) throw new Error('fixture palette not found')
  return palette
}

const THREE_PLAYER = '../../../fixtures/board-draft-3player.png'
const ENDGAME = '../../../fixtures/board-endgame-pieces.png'
// Both fixtures draw the roster on one row of 12px dots. The bands run from the
// cards' top edge down to the board background, which starts lower in the
// endgame screenshot; the gutter columns are clear of the cards' border strokes.
const ROSTER_ROW_Y = 406.5
const ROSTER_DOT_RADIUS = 12
const THREE_PLAYER_BAND = { top: 340, bottom: 552 }
const ENDGAME_BAND = { top: 340, bottom: 764 }
const ENDGAME_GUTTER = 289

const statsIssues = (result: Extract<SourceParse, { ok: true }>) =>
  result.issues.filter((issue) => issue.stage === 'stats')
const rosterMessages = (result: Extract<SourceParse, { ok: true }>) =>
  result.issues.filter((issue) => issue.stage === 'roster').map((issue) => issue.message)
const counterRows = (result: Extract<SourceParse, { ok: true }>) =>
  Object.entries(result.game.stats).map(([id, stats]) =>
    [id, stats.handUnknown, stats.devCards, stats.knights, stats.vpCards])
// Reads a surviving chip's expected counters off the pinned five-player stats,
// so an assertion shows which seat it belonged to before the roster renumbered.
const seatCounters = (seat: keyof typeof expectedEndgameStats) => {
  const { handUnknown, devCards, knights, vpCards } = expectedEndgameStats[seat]
  return [handUnknown, devCards, knights, vpCards]
}

describe('hostile parser inputs', () => {
  it('rejects solid color and header-only inputs without throwing', () => {
    const solid = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(255) }
    expect(parseScreenshot(solid).ok).toBe(false)
    const full = load()
    expect(parseScreenshot({ width: full.width, height: 500, data: full.data.slice(0, full.width * 500 * 4) }).ok).toBe(false)
  })

  it('degrades schema-validly after nearest-neighbor downscaling', () => {
    const result = parseScreenshot(nearestHalf(load()))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedDraft as Board)
    // fixture1-halfscale-parse-output.txt baseline: 26 decoded tokens.
    expect(result.game.board.hexes.filter((hex) => hex.numberToken !== null)).toHaveLength(26)
    for (const hex of result.game.board.hexes) {
      const pinned = (expectedDraft as Board).hexes.find((candidate) =>
        candidate.coord.q === hex.coord.q && candidate.coord.r === hex.coord.r)
      if (hex.numberToken !== null) expect(hex.numberToken).toBe(pinned?.numberToken)
      else if (hex.tile !== 'desert') {
        expect(result.issues.some((issue) => issue.ref === `${hex.coord.q},${hex.coord.r}`)).toBe(true)
      }
    }
  })

  it('synthesizes a roster when the header is cropped', () => {
    const full = load()
    const top = 520
    const result = parseScreenshot({
      width: full.width,
      height: full.height - top,
      data: full.data.slice(top * full.width * 4),
    })
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.length).toBeGreaterThan(0)
  })

  it('reads a two-card roster rather than falling back to synthesis', () => {
    const threePlayer = load(THREE_PLAYER)
    // Settled widens the cards of a short roster, which erasing one cannot
    // reproduce, so this pins the count rather than the geometry.
    const result = parseScreenshot(withoutSlots(threePlayer, THREE_PLAYER_BAND, [
      { gutterX: 452, fromX: 860, toX: threePlayer.width },
    ]))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((player) => player.id)).toEqual(['p1', 'p2'])
    expect(result.game.board.players.map((player) => player.color))
      .toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.blue])
    // The erased card was this screenshot's own, so losing the You marker with
    // it is correct; nothing else about the shorter roster may be flagged.
    expect(rosterMessages(result)).toEqual(['Could not identify the You chip'])
    expect(statsIssues(result)).toEqual([])
    for (const stats of Object.values(result.game.stats)) {
      expect(stats).toEqual({
        hand: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 },
        handUnknown: 0,
        devCards: 0,
        knights: 0,
        vpCards: 0,
      })
    }
  })

  // The shape a seat whose colour the palette does not know leaves behind, which
  // today means a sixth (brown) player: both hole tests simulate that gap and can
  // retire once the palette learns the colour. The cards either side keep their
  // normal width, so the derived width has to survive a doubled gap.
  it('keeps the surviving counters readable when a middle card is missing', () => {
    const result = parseScreenshot(withoutSlots(load(ENDGAME), ENDGAME_BAND, [
      { gutterX: ENDGAME_GUTTER, fromX: 542, toX: 790 },
    ]))
    if (!expectSchemaValid(result)) return
    // Ids are positional, so the fourth and fifth seats shift down a slot. The
    // erased seat comes back last, from its pieces, with no chip to read.
    expect(result.game.board.players.map((player) => player.color)).toEqual([
      PLAYER_PALETTE.red, PLAYER_PALETTE.blue, PLAYER_PALETTE.white, PLAYER_PALETTE.green,
      PLAYER_PALETTE.orange,
    ])
    expect(rosterMessages(result)).toEqual(['Synthesized a player for an unmatched orange piece'])
    expect(statsIssues(result)).toEqual([])
    expect(counterRows(result)).toEqual([
      ['p1', ...seatCounters('p1')],
      ['p2', ...seatCounters('p2')],
      ['p3', ...seatCounters('p4')],
      ['p4', ...seatCounters('p5')],
      ['s-orange', 0, 0, 0, 0],
    ])
  })

  // Two such seats leave two gaps, [247, 495], and an even count has no single
  // middle: a median that rounds up returns the merged gap and sizes every card
  // at twice its slot. Only the dots go here, so the cards they belonged to still
  // hold counters for an oversized neighbour to read as its own.
  it('sizes cards from the narrowest gap when the holes leave an even gap count', () => {
    // Tiled from a blank column of each seat's own card, so the dot's slot keeps
    // the chip cream around it rather than the page behind the row.
    const result = parseScreenshot(withoutSlots(load(ENDGAME), { top: 389, bottom: 424 }, [
      { gutterX: 552, fromX: 566, toX: 602 },
      { gutterX: 1047, fromX: 1060, toX: 1096 },
    ]))
    if (!expectSchemaValid(result)) return
    // Both erased seats still own pieces, so they return synthesized and last.
    expect(result.game.board.players.map((player) => player.color)).toEqual([
      PLAYER_PALETTE.red, PLAYER_PALETTE.blue, PLAYER_PALETTE.white,
      PLAYER_PALETTE.orange, PLAYER_PALETTE.green,
    ])
    expect(rosterMessages(result)).toEqual([
      'Synthesized a player for an unmatched orange piece',
      'Synthesized a player for an unmatched green piece',
    ])
    expect(statsIssues(result)).toEqual([])
    expect(counterRows(result)).toEqual([
      ['p1', ...seatCounters('p1')],
      ['p2', ...seatCounters('p2')],
      ['p3', ...seatCounters('p4')],
      ['s-orange', 0, 0, 0, 0],
      ['s-green', 0, 0, 0, 0],
    ])
  })

  // Header furniture can outnumber the cards, so the row with the most dots is
  // not the roster; the row nearest the board is.
  it('ignores a decoy row above the roster that carries more dots', () => {
    const threePlayer = load(THREE_PLAYER)
    const player = fixturePalette(threePlayer).player
    const decoys = [player.red, player.blue, player.orange, player.white]
    const result = parseScreenshot(withStampedDots(threePlayer, decoys.map((color, index) => ({
      x: 200 + 200 * index,
      y: 200,
      radius: ROSTER_DOT_RADIUS,
      color,
    }))))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3'])
    expect(result.game.board.players.map((entry) => entry.color))
      .toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.blue, PLAYER_PALETTE.orange])
    expect(statsIssues(result)).toEqual([])
  })

  // A colour cannot repeat across cards, so a second blob of one is not a fourth
  // seat: counted, it would shrink the pitch and clip every card.
  it('ignores a duplicate-colour blob sitting inside the roster row', () => {
    const threePlayer = load(THREE_PLAYER)
    const result = parseScreenshot(withStampedDots(threePlayer, [
      // Within the row's radius agreement, so the row still reads as cards and
      // the blob has to be dropped on colour rather than on size.
      {
        x: 300,
        y: ROSTER_ROW_Y,
        radius: ROSTER_DOT_RADIUS - 2,
        color: fixturePalette(threePlayer).player.red,
      },
    ]))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3'])
    expect(result.game.board.players.map((entry) => entry.color))
      .toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.blue, PLAYER_PALETTE.orange])
    expect(statsIssues(result)).toEqual([])
  })

  it('retains all endgame pieces after nearest-neighbor downscaling', () => {
    const result = parseScreenshot(nearestHalf(load('../../../fixtures/board-endgame-pieces.png')))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedEndgame as Board)
    // fixture2-halfscale-parse-output.txt baseline: 24 decoded tokens.
    expect(result.game.board.hexes.filter((hex) => hex.numberToken !== null)).toHaveLength(24)
    assertNullTokensFlagged(result)
    assertStatsNeverGuess(result)
  })

  it.each([
    // f2-half-bilinear-parse-output.txt baseline: 9 decoded tokens.
    ['integer half-scale', 2, 9],
    // f2-harsh-bilinear55-parse-output.txt baseline: 18 decoded tokens.
    ['harsh fractional scale', 1.8, 18],
  ] as const)('gates tokens but preserves board structure on a bilinear %s', (_name, factor, decodedCount) => {
    const original = load('../../../fixtures/board-endgame-pieces.png')
    const softened = bilinear(original, factor)
    expect(softened.data).not.toEqual(nearestHalf(original).data)
    const result = parseScreenshot(softened)
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedEndgame as Board)
    expect(result.issues.some((issue) => issue.stage === 'sharpness')).toBe(true)
    const decoded = result.game.board.hexes.filter((candidate) => candidate.numberToken !== null)
    expect(decoded).toHaveLength(decodedCount)
    for (const hex of decoded) {
      const ref = `${hex.coord.q},${hex.coord.r}`
      const pinned = (expectedEndgame as Board).hexes.find((candidate) =>
        candidate.coord.q === hex.coord.q && candidate.coord.r === hex.coord.r)
      expect(hex.numberToken).toBe(pinned?.numberToken)
      expect(result.issues.some((issue) => issue.stage === 'tokens' && issue.ref === ref)).toBe(true)
    }
    assertNullTokensFlagged(result)
    assertStatsNeverGuess(result)
  })

  it('flags a pixel-copied pill equidistant from two coastal edges', () => {
    const result = parseScreenshot(withAmbiguousPill(load()))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) => issue.stage === 'ports' && issue.message.includes('equidistant'))).toBe(true)
  })

  it('keeps the real robber when a smaller dark-core candidate appears earlier', () => {
    const result = parseScreenshot(withSecondRobberCandidate(load()))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.robber).toEqual((expectedDraft as Board).robber)
    expect(result.issues.some((issue) =>
      issue.stage === 'tokens' && issue.message.includes('Multiple robber candidates'),
    )).toBe(true)
  })

  it('warns when two detected pills claim the same coastal edge', () => {
    const result = parseScreenshot(withDuplicateEdgePill(load()))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) =>
      issue.stage === 'ports' && issue.message.includes('duplicate port pill'),
    )).toBe(true)
  })
})
