import { describe, expect, it } from 'vitest'
import { parseBoard } from '../../model/serialization'
import { parseEdgeId } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { parseScreenshot, type RgbaImage, type SourceParse } from '../index'
import { cropImage, nearColor, pixel } from '../image'
import { labelComponents } from '../components'
import type { ParserPalette } from '../palette'
import { vertexPoint } from '../pieces'
import { registerBoard } from '../registration'
import { choosePalette } from '../sources/settled/palette'
import { analyzeToken } from '../tokens'
import { colored, copy, load, nearestScale, paint, sorted } from './pillPixels'
import expectedDraft from './expected/settled-5p-draft-start.json'
import expectedEndgame from './expected/board-endgame-pieces.json'

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

function assertStableBoard(actual: Board, expected: Board, synthesized = false) {
  expect(actual.hexes.map((hex) => ({ coord: hex.coord, tile: hex.tile }))).toEqual(
    expected.hexes.map((hex) => ({ coord: hex.coord, tile: hex.tile })),
  )
  expect(sorted(actual.ports)).toEqual(sorted(expected.ports))
  const actualColors = actual.players.map((player) => player.color)
  const expectedColors = expected.players.map((player) => player.color)
  expect(synthesized ? actualColors.sort() : actualColors).toEqual(synthesized ? expectedColors.sort() : expectedColors)
  expect(actual.robber).toEqual(expected.robber)
  expect(sorted(colored(actual, actual.roads))).toEqual(sorted(colored(expected, expected.roads)))
  expect(sorted(colored(actual, actual.buildings))).toEqual(sorted(colored(expected, expected.buildings)))
}

function fixturePalette(image: RgbaImage): ParserPalette {
  const palette = choosePalette(image)
  if (!palette) throw new Error('fixture palette not found')
  return palette
}

function withPortPill(image: RgbaImage, duplicate: boolean): RgbaImage {
  const palette = fixturePalette(image)
  const registration = registerBoard(image, palette)!
  const parsed = parseScreenshot(image)
  if (!parsed.ok) throw new Error(parsed.error)
  const used = new Set(parsed.game.board.ports.map((port) => port.edgeId))
  const edges = boardGrid(registration.layout).coastalEdgeIds.map((edgeId) => {
    const [a, b] = parseEdgeId(edgeId).map(registration.center)
    return { edgeId, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
  })
  const source = [...labelComponents(
    { minX: 0, maxX: image.width - 1, minY: registration.bandTop, maxY: registration.bandBottom },
    (x, y) => nearColor(pixel(image, x, y), palette.tokenCream, 18) ? true : null,
  )].find((component) => (component.maxX - component.minX) / (component.maxY - component.minY) > 2 &&
    component.area > 0.15 * registration.size ** 2)!
  const rect = { x: source.minX - 4, y: source.minY - 4, width: source.maxX - source.minX + 9, height: source.maxY - source.minY + 9 }
  let best: { x: number; y: number; score: number } | null = null
  for (let y = registration.bandTop + rect.height / 2; y < registration.bandBottom - rect.height / 2; y += 3) {
    for (let x = rect.width / 2; x < image.width - rect.width / 2; x += 3) {
      if (registration.tiles.some((tile) => Math.hypot(x - registration.center(tile)[0], y - registration.center(tile)[1]) < 1.12 * registration.size)) continue
      let clear = true
      for (let dy = -rect.height / 2; dy <= rect.height / 2; dy += 8) {
        for (let dx = -rect.width / 2; dx <= rect.width / 2; dx += 8) {
          if (!nearColor(pixel(image, x + dx, y + dy), palette.bgBlue, 12)) clear = false
        }
      }
      if (!clear) continue
      const ranked = edges.map((edge) => ({ ...edge, distance: Math.hypot(x - edge.x, y - edge.y) })).sort((a, b) => a.distance - b.distance)
      if (ranked[0].distance > 1.05 * registration.size || used.has(ranked[0].edgeId) !== duplicate) continue
      const score = Math.abs(ranked[1].distance / ranked[0].distance - 1)
      if (!best || score < best.score) best = { x, y, score }
    }
  }
  if (!best || (!duplicate && best.score >= 0.03)) throw new Error('port target not found')
  copy(image, rect, Math.round(best.x - rect.width / 2), Math.round(best.y - rect.height / 2))
  return image
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

describe('hostile parser inputs', () => {
  it('rejects solid color and header-only inputs without throwing', () => {
    const solid = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(255) }
    expect(parseScreenshot(solid).ok).toBe(false)
    const full = load()
    expect(parseScreenshot({ width: full.width, height: 500, data: full.data.slice(0, full.width * 500 * 4) }).ok).toBe(false)
  })

  it('degrades schema-validly after nearest-neighbor downscaling', () => {
    const result = parseScreenshot(nearestScale(load('settled-5p-draft-start')))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedDraft as Board)
    expect(result.game.board.hexes.filter((hex) => hex.numberToken !== null).length).toBe(28)
    for (const hex of result.game.board.hexes) {
      const pinned = (expectedDraft as Board).hexes.find((candidate) => candidate.coord.q === hex.coord.q && candidate.coord.r === hex.coord.r)
      if (hex.numberToken !== null) expect(hex.numberToken).toBe(pinned?.numberToken)
    }
    assertNullTokensFlagged(result)
  })

  it('synthesizes the top-cropped roster from piece colours', () => {
    const full = load()
    const result = parseScreenshot(cropImage(full, { x: 0, y: 550, width: full.width, height: full.height - 550 }))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players).toEqual([{ id: 's-white', name: 'White', color: PLAYER_PALETTE.white }])
    expect(result.game.board.mePlayerId).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'roster', message: 'Roster was synthesized from detected pieces' }))
    expect(result.game.board.buildings).toHaveLength(1)
    expect(result.game.board.roads).toHaveLength(1)
  })

  it.each([200, 364])('ignores player-colour dots outside pills at y=%s', (cy) => {
    const image = load('settled-3p-pick-cards')
    for (const [index, color] of Object.values(fixturePalette(image).player).entries()) {
      const cx = cy === 200 ? 200 + index * 150 : 80
      for (let y = cy - 10; y <= cy + 10; y += 1) {
        for (let x = cx - 10; x <= cx + 10; x += 1) {
          if (Math.hypot(x - cx, y - cy) <= 10) paint(image, { x, y, width: 1, height: 1 }, color)
        }
      }
    }
    const result = parseScreenshot(image)
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((entry) => entry.color)).toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.white, PLAYER_PALETTE.green])
    expect(result.issues).toEqual([])
  })

  it.each([
    ['unknown', [150, 30, 180]],
    ['duplicate', [194, 63, 56]],
  ] as const)('warns when a pill is skipped for an %s colour', (_reason, color) => {
    const image = load('settled-3p-pick-cards')
    paint(image, { x: 525, y: 353, width: 24, height: 24 }, color)
    const result = parseScreenshot(image)
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((player) => player.color)).toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.green])
    expect(result.issues.filter((issue) => issue.stage === 'roster')).toEqual([
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('Skipped player pill 2') }),
    ])
  })

  it('retains all endgame pieces after nearest-neighbor downscaling', () => {
    const result = parseScreenshot(nearestScale(load('board-endgame-pieces')))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedEndgame as Board, true)
    expect(result.game.board.hexes.filter((hex) => hex.numberToken !== null).length).toBe(28)
    assertNullTokensFlagged(result)
  })

  it.each([
    ['integer half-scale', 2, 9],
    ['harsh fractional scale', 1.8, 19],
  ] as const)('gates tokens but preserves board structure on a bilinear %s', (_name, factor, decodedCount) => {
    const original = load('board-endgame-pieces')
    const softened = bilinear(original, factor)
    expect(softened.data).not.toEqual(nearestScale(original).data)
    const result = parseScreenshot(softened)
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.game.board, expectedEndgame as Board, true)
    expect(result.issues.some((issue) => issue.stage === 'sharpness')).toBe(true)
    const decoded = result.game.board.hexes.filter((candidate) => candidate.numberToken !== null)
    expect(decoded.length).toBe(decodedCount)
    for (const hex of decoded) {
      const ref = `${hex.coord.q},${hex.coord.r}`
      const pinned = (expectedEndgame as Board).hexes.find((candidate) => candidate.coord.q === hex.coord.q && candidate.coord.r === hex.coord.r)
      expect(hex.numberToken).toBe(pinned?.numberToken)
      expect(result.issues.some((issue) => issue.stage === 'tokens' && issue.ref === ref)).toBe(true)
    }
    assertNullTokensFlagged(result)
  })

  it('flags a pixel-copied pill equidistant from two coastal edges', () => {
    const result = parseScreenshot(withPortPill(load('settled-5p-draft-start'), false))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) => issue.stage === 'ports' && issue.message.includes('equidistant'))).toBe(true)
  })

  it('keeps the real robber when a smaller dark-core candidate appears earlier', () => {
    const result = parseScreenshot(withSecondRobberCandidate(load('settled-5p-draft-start')))
    if (!expectSchemaValid(result)) return
    expect(result.game.board.robber).toEqual((expectedDraft as Board).robber)
    expect(result.issues.some((issue) => issue.stage === 'tokens' && issue.message.includes('Multiple robber candidates'))).toBe(true)
  })

  it('warns when two detected pills claim the same coastal edge', () => {
    const result = parseScreenshot(withPortPill(load('settled-5p-draft-start'), true))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) => issue.stage === 'ports' && issue.message.includes('duplicate port pill'))).toBe(true)
  })

  it.each([
    ['brown', [95, 76, 64], 0.7],
    ['brown', [95, 76, 64], 1],
    ['red', [194, 63, 56], 0.4],
    ['red', [194, 63, 56], 0.7],
    ['red', [194, 63, 56], 1],
  ] as const)('ignores every open-vertex disc with %s pigment %j at opacity %s', (_name, pigment, opacity) => {
    const image = load('settled-3p-pick-cards')
    const registration = registerBoard(image, fixturePalette(image))!
    const radius = 0.23 * registration.size
    for (const vertexId of boardGrid(registration.layout).vertexIds) {
      const [cx, cy] = vertexPoint(registration, vertexId)
      for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
          if (Math.hypot(x - cx, y - cy) > radius) continue
          const before = pixel(image, x, y)
          const blend = (channel: number) => Math.round(before[channel] * (1 - opacity) + pigment[channel] * opacity)
          paint(image, { x, y, width: 1, height: 1 }, [blend(0), blend(1), blend(2)])
        }
      }
    }
    const result = parseScreenshot(image)
    if (!expectSchemaValid(result)) return
    expect(result.game.board.buildings).toEqual([])
    expect(result.game.board.roads).toEqual([])
    expect(result.game.board.players.map((player) => player.color)).toEqual([PLAYER_PALETTE.red, PLAYER_PALETTE.white, PLAYER_PALETTE.green])
    expect(result.issues).toEqual([])
  })

  it.each([
    ['settled-3p-pick-cards', 180, 314, 6, [PLAYER_PALETTE.red, PLAYER_PALETTE.white, PLAYER_PALETTE.green]],
    ['settled-5p-draft-start', 340, 428, 22, [PLAYER_PALETTE.white, PLAYER_PALETTE.brown, PLAYER_PALETTE.blue, PLAYER_PALETTE.red, PLAYER_PALETTE.green]],
  ] as const)('retains roster order when a pill widens in %s', (name, left, top, extra, colors) => {
    const image = load(name)
    const source = { ...image, data: image.data.slice() }
    const split = left + 205
    for (let y = top; y < top + 105; y += 1) {
      for (let x = split; x < left + 310 + extra; x += 1) {
        paint(image, { x, y, width: 1, height: 1 }, pixel(source, Math.max(split, x - extra), y))
      }
    }
    const result = parseScreenshot(image)
    if (!expectSchemaValid(result)) return
    expect(result.game.board.players.map((player) => player.color)).toEqual(colors)
    expect(result.game.board.mePlayerId).toBe('p1')
    expect(Object.values(result.game.stats).map((stats) => stats.handUnknown)).toEqual(colors.map(() => 0))
    expect(result.issues).toEqual([])
  })

  it('ignores the real blinking discs while retaining the outlined settlement and road', () => {
    const image = load()
    const result = parseScreenshot(image)
    if (!expectSchemaValid(result)) return
    expect(result.issues).toEqual([])
    expect(result.game.board.buildings).toHaveLength(1)
    expect(result.game.board.roads).toHaveLength(1)
  })

  it('leaves an ambiguous token unreadable after fractional nearest downscaling', () => {
    const image = nearestScale(load(), 2.25)
    const palette = fixturePalette(image)
    const registration = registerBoard(image, palette)!
    expect(analyzeToken(image, palette, ...registration.center({ q: -2, r: 1 }), registration.size).number).toBeNull()
  })

  it('reads the sheep 10 directly before missing-token inference', () => {
    const image = load('settled-5p-draft-start')
    const palette = fixturePalette(image)
    const registration = registerBoard(image, palette)!
    const [x, y] = registration.center({ q: -1, r: -1 })
    expect(analyzeToken(image, palette, x, y, registration.size).number).toBe(10)
  })
})
