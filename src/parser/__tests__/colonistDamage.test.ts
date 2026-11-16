import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { axialKey, vertexIdOf } from '../../model/coords'
import { addPlayer } from '../../model/board'
import { mergeScreenshot, newGame } from '../../model/game'
import type { AxialCoord } from '../../model/types'
import { importQuestions } from '../../ui/importQuestions'
import { cropImage, pixel, type Rect, type Rgb } from '../image'
import { parseScreenshot, type RgbaImage } from '../index'
import { vertexPoint } from '../pieces'
import { parseColonist } from '../sources/colonist'
import { detectPorts } from '../sources/colonist/ports'
import { registerBoard } from '../sources/colonist/registration'
import type { ParseIssue } from '../sources/types'

const dir = fileURLToPath(new URL('../../../fixtures/colonist.local/', import.meta.url))
const midgame = 'd-10-two-green-cities-two-red'

function load(name = midgame): RgbaImage {
  const png = PNG.sync.read(readFileSync(`${dir}${name}.png`))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

function registered(image: RgbaImage) {
  const registration = registerBoard(image)
  expect(registration).not.toBeNull()
  return registration!
}

function paint(image: RgbaImage, rect: Rect, color: Rgb) {
  for (let y = Math.round(rect.y); y < Math.round(rect.y + rect.height); y += 1) {
    for (let x = Math.round(rect.x); x < Math.round(rect.x + rect.width); x += 1) {
      image.data.set(color, (y * image.width + x) * 4)
    }
  }
}

function copy(image: RgbaImage, rect: Rect, x: number, y: number) {
  const source = cropImage(image, rect)
  for (let row = 0; row < source.height; row += 1) {
    const start = row * source.width * 4
    image.data.set(source.data.subarray(start, start + source.width * 4),
      ((Math.round(y) + row) * image.width + Math.round(x)) * 4)
  }
}

function token(image: RgbaImage, number: number) {
  const registration = registered(image)
  const result = parseScreenshot(image)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  const hex = result.game.board.hexes.find((hex) => hex.numberToken === number)!
  return registration.squares.find((square) => axialKey(square) === axialKey(hex.coord))!
}

describe.skipIf(!existsSync(dir))('Colonist damaged screenshots', () => {
  it('asks for the whole order when a missing panel player is recovered from pieces', () => {
    const image = load()
    const registration = registered(image)
    const [x, y] = registration.center({ q: 2, r: 0 })
    const size = registration.size
    const background = pixel(image, x + 7.23 * size, y + 3.46 * size)
    paint(image, { x: x + 6.35 * size, y: y + 3.13 * size,
      width: 0.66 * size, height: 0.66 * size }, background)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.board.players).toHaveLength(4)
    expect(result.read.knights).toHaveLength(3)
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'roster', message: expect.stringContaining('Synthesized a player') }))
    expect(result.read.roster).toBe(false)
    expect(result.read.order).toBe(false)
    expect(importQuestions(result.game, result.read).order).toBe('all')

    const saved = newGame(addPlayer(result.game.board, { id: 'saved', name: 'Saved', color: '#884400' }))
    expect(mergeScreenshot(saved, result.game, result.read).board.players).toEqual(saved.board.players)
  })

  it('a: flags a hidden rival avatar', () => {
    const image = load()
    const registration = registered(image)
    const [x, y] = registration.center({ q: 2, r: 0 })
    const size = registration.size

    // The middle rival's avatar on d-10, measured relative to the board.
    const background = pixel(image, x + 7.23 * size, y + 3.46 * size)
    paint(image, { x: x + 6.35 * size, y: y + 3.13 * size,
      width: 0.66 * size, height: 0.66 * size }, background)
    const result = parseScreenshot(image)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'roster', severity: 'unreadable' }))
  })

  it('b: flags terrain copied over a different resource', () => {
    const image = load()
    const registration = registered(image)
    const size = registration.size
    const source = registration.center({ q: 0, r: -2 })
    const target = registration.center({ q: 1, r: -2 })

    // Both flanks carry terrain while the cream token stays intact.
    for (const offset of [-0.64, 0.38]) {
      copy(image, { x: source[0] + offset * size, y: source[1] - 0.12 * size,
        width: 0.26 * size, height: 0.6 * size }, target[0] + offset * size, target[1] - 0.12 * size)
    }
    const result = parseScreenshot(image)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'registration', severity: 'unreadable' }))
  })

  it('c: flags a duplicated number token', () => {
    const image = load()
    const source = token(image, 8)
    const target = token(image, 6)
    copy(image, { x: source.minX, y: source.minY, width: source.maxX - source.minX + 1,
      height: source.maxY - source.minY + 1 }, target.minX, target.minY)
    const result = parseScreenshot(image)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'tokens', severity: 'unreadable' }))
  })

  it('d: flags a red digit recoloured green with its pips intact', () => {
    const image = load()
    const square = token(image, 6)
    const greenSquare = token(image, 3)
    let green: Rgb | undefined
    for (let y = greenSquare.minY; y <= greenSquare.maxY && !green; y += 1) {
      for (let x = greenSquare.minX; x <= greenSquare.maxX; x += 1) {
        const color = pixel(image, x, y)
        if (color[0] < 90 && color[1] < 130 && color[1] > 1.2 * color[0] && color[2] < 100) {
          green = color
          break
        }
      }
    }
    expect(green).toBeDefined()
    const side = square.maxX - square.minX + 1
    for (let y = square.minY; y < square.minY + 0.72 * side; y += 1) {
      for (let x = square.minX; x <= square.maxX; x += 1) {
        const [r, g, b] = pixel(image, x, y)
        if (r > 2 * g && g < 130 && b < 100) paint(image, { x, y, width: 1, height: 1 }, green!)
      }
    }
    const result = parseScreenshot(image)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({
      stage: 'tokens', severity: 'unreadable', ref: axialKey(square),
    }))
  })

  it('e: keeps first player unknown when a settlement is hidden', () => {
    const image = load('d-03-draft-complete')
    const registration = registered(image)
    const size = registration.size
    const coord: AxialCoord = { q: 2, r: -2 }
    const vertex = vertexIdOf([coord, { q: 2, r: -1 }, { q: 1, r: -1 }])
    const [x, y] = vertexPoint(registration, vertex)
    const background = pixel(image, x - 0.35 * size, y - 0.4 * size)
    paint(image, { x: x - 0.3 * size, y: y - 0.4 * size, width: 0.6 * size, height: 0.6 * size }, background)
    const result = parseScreenshot(image)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.board.buildings.some((building) => building.vertexId === vertex)).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'stats', severity: 'warning' }))
    expect(result.read.order).toBe(false)
  })

  it('f: handles a crop through the right harbour without throwing', () => {
    const image = load()
    const registration = registered(image)
    const cropped = cropImage(image, { x: 0, y: 0,
      width: registration.center({ q: 2, r: 0 })[0] + registration.size, height: image.height })
    const result = parseScreenshot(cropped)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ stage: 'ports' }))
    else expect(parseColonist(cropped)).toBeNull()

    // The sail reader must also tolerate windows wholly beyond the cropped edge.
    const issues: ParseIssue[] = []
    detectPorts(cropped, registration, issues)
    expect(issues).toContainEqual(expect.objectContaining({ stage: 'ports' }))
  })

  it('g: refuses a crop through the top north corners', () => {
    const image = load()
    const registration = registered(image)
    const y = Math.round(registration.center({ q: 0, r: -2 })[1] - registration.size)
    const cropped = cropImage(image, { x: 0, y, width: image.width, height: image.height - y })
    expect(registerBoard(cropped)).toBeNull()
    const result = parseScreenshot(cropped)
    if (result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'unreadable' }))
  })
})
