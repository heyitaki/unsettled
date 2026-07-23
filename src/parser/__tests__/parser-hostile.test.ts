import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseBoard } from '../../model/serialization'
import { parseEdgeId } from '../../model/coords'
import { boardGrid, defaultPortEdges } from '../../model/layouts'
import type { Board } from '../../model/types'
import {
  parseBoardImage,
  type ParseBoardImageResult,
  type RgbaImage,
} from '../index'
import { nearColor, pixel } from '../image'
import { choosePalette } from '../palette'
import { registerBoard } from '../registration'
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

function expectSchemaValid(result: ParseBoardImageResult): result is Extract<ParseBoardImageResult, { ok: true }> {
  expect(result.ok).toBe(true)
  if (!result.ok) return false
  expect(parseBoard(result.board).ok).toBe(true)
  return true
}

function assertNullTokensFlagged(result: Extract<ParseBoardImageResult, { ok: true }>) {
  for (const hex of result.board.hexes.filter((candidate) =>
    candidate.tile !== 'desert' && candidate.numberToken === null)) {
    const ref = `${hex.coord.q},${hex.coord.r}`
    expect(result.issues.some((issue) =>
      issue.stage === 'tokens' && issue.ref === ref &&
      (issue.severity === 'unreadable' || issue.message.toLowerCase().includes('review')),
    )).toBe(true)
  }
}

function withSecondRobberCandidate(image: RgbaImage): RgbaImage {
  const palette = choosePalette(image)
  if (!palette) throw new Error('fixture palette not found')
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
  const palette = choosePalette(image)
  if (!palette) throw new Error('fixture palette not found')
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

describe('hostile parser inputs', () => {
  it('rejects solid color and header-only inputs without throwing', () => {
    const solid = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(255) }
    expect(parseBoardImage(solid).ok).toBe(false)
    const full = load()
    expect(parseBoardImage({ width: full.width, height: 500, data: full.data.slice(0, full.width * 500 * 4) }).ok).toBe(false)
  })

  it('degrades schema-validly after nearest-neighbor downscaling', () => {
    const result = parseBoardImage(nearestHalf(load()))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.board, expectedDraft as Board)
    // fixture1-halfscale-parse-output.txt baseline: 26 decoded tokens.
    expect(result.board.hexes.filter((hex) => hex.numberToken !== null)).toHaveLength(26)
    for (const hex of result.board.hexes) {
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
    const result = parseBoardImage({
      width: full.width,
      height: full.height - top,
      data: full.data.slice(top * full.width * 4),
    })
    if (!expectSchemaValid(result)) return
    expect(result.board.players.length).toBeGreaterThan(0)
  })

  it('retains all endgame pieces after nearest-neighbor downscaling', () => {
    const result = parseBoardImage(nearestHalf(load('../../../fixtures/board-endgame-pieces.png')))
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.board, expectedEndgame as Board)
    // fixture2-halfscale-parse-output.txt baseline: 24 decoded tokens.
    expect(result.board.hexes.filter((hex) => hex.numberToken !== null)).toHaveLength(24)
    assertNullTokensFlagged(result)
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
    const result = parseBoardImage(softened)
    if (!expectSchemaValid(result)) return
    assertStableBoard(result.board, expectedEndgame as Board)
    expect(result.issues.some((issue) => issue.stage === 'sharpness')).toBe(true)
    const decoded = result.board.hexes.filter((candidate) => candidate.numberToken !== null)
    expect(decoded).toHaveLength(decodedCount)
    for (const hex of decoded) {
      const ref = `${hex.coord.q},${hex.coord.r}`
      const pinned = (expectedEndgame as Board).hexes.find((candidate) =>
        candidate.coord.q === hex.coord.q && candidate.coord.r === hex.coord.r)
      expect(hex.numberToken).toBe(pinned?.numberToken)
      expect(result.issues.some((issue) => issue.stage === 'tokens' && issue.ref === ref)).toBe(true)
    }
    assertNullTokensFlagged(result)
  })

  it('flags a pixel-copied pill equidistant from two coastal edges', () => {
    const result = parseBoardImage(withAmbiguousPill(load()))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) => issue.stage === 'ports' && issue.message.includes('equidistant'))).toBe(true)
  })

  it('keeps the real robber when a smaller dark-core candidate appears earlier', () => {
    const result = parseBoardImage(withSecondRobberCandidate(load()))
    if (!expectSchemaValid(result)) return
    expect(result.board.robber).toEqual((expectedDraft as Board).robber)
    expect(result.issues.some((issue) =>
      issue.stage === 'tokens' && issue.message.includes('Multiple robber candidates'),
    )).toBe(true)
  })

  it('warns when two detected pills claim the same coastal edge', () => {
    const result = parseBoardImage(withDuplicateEdgePill(load()))
    if (!expectSchemaValid(result)) return
    expect(result.issues.some((issue) =>
      issue.stage === 'ports' && issue.message.includes('duplicate port pill'),
    )).toBe(true)
  })
})
