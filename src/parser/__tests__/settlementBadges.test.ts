import { describe, expect, it } from 'vitest'
import { labelPixelSet } from '../components'
import { parseScreenshot } from '../index'
import { cropImage, nearColor, pixel } from '../image'
import { detectPieces, orderDraftSettlements, readSettlementOrdinal, vertexPoint } from '../pieces'
import { registerBoard } from '../registration'
import { choosePalette } from '../sources/settled/palette'
import { copy, load, paint } from './pillPixels'

const vertex = 'v:-1,-1;-1,0;0,-1'

describe('settlement badges', () => {
  it('returns no badge when a right crop leaves an empty search rectangle', () => {
    const image = load()
    const palette = choosePalette(image)!
    const registration = registerBoard(image, palette)!
    const cropped = cropImage(image, { x: 0, y: 0, width: 455, height: image.height })
    expect(readSettlementOrdinal(cropped, palette, registration, vertex)).toBeNull()
  })

  it('reads the real one-bar badge and a pixel-copied two-bar badge', () => {
    const image = load()
    const palette = choosePalette(image)!
    const registration = registerBoard(image, palette)!
    expect(readSettlementOrdinal(image, palette, registration, vertex)).toBe(1)
    const source = { ...image, data: image.data.slice() }
    paint(image, { x: 480, y: 1322, width: 6, height: 17 }, palette.tokenCream)
    copy(source, { x: 480, y: 1322, width: 6, height: 17 }, 476, 1322)
    copy(image, { x: 476, y: 1322, width: 6, height: 17 }, 476, 1322, source)
    copy(image, { x: 476, y: 1322, width: 6, height: 17 }, 485, 1322)
    expect(readSettlementOrdinal(image, palette, registration, vertex)).toBe(2)
  })
})

describe('imported settlement order', () => {
  const vertices = [
    'v:0,-3;0,-2;1,-3',
    'v:1,-2;1,-1;2,-2',
    'v:-2,0;-2,1;-1,0',
    'v:-1,2;-1,3;0,2',
    'v:-1,-1;-1,0;0,-1',
    'v:0,0;0,1;1,0',
  ] as const

  function scene(ordinals: readonly (1 | 2 | null)[], complete = false) {
    const source = load()
    const image = load('settled-3p-pick-cards')
    const palette = choosePalette(image)!
    const registration = registerBoard(image, palette)!
    const ink = new Set<string>()
    for (let y = 1300; y < 1390; y += 1) {
      for (let x = 420; x < 490; x += 1) {
        if (nearColor(pixel(source, x, y), palette.player.white, 22)) ink.add(`${x},${y}`)
      }
    }
    const house = labelPixelSet(ink).sort((a, b) => b.area - a.area)[0]
    const sourceRegistration = registerBoard(source, palette)!
    const [sx, sy] = vertexPoint(sourceRegistration, vertex)
    const owners = [{ id: 'p1', anchor: palette.player.white }, { id: 'p2', anchor: palette.player.brown }, { id: 'p3', anchor: palette.player.green }]
    if (complete) {
      paint(image, { x: 201, y: 353, width: 24, height: 24 }, palette.player.white)
      paint(image, { x: 525, y: 353, width: 24, height: 24 }, palette.player.brown)
    }
    for (const [index, id] of vertices.slice(0, complete ? 6 : 4).entries()) {
      const [x, y] = vertexPoint(registration, id)
      const dx = Math.round(x - sx)
      const dy = Math.round(y - sy)
      const owner = owners[index >= 4 ? 2 : index === 0 || index === 3 ? 0 : 1]
      for (const [px, py] of house.points) {
        paint(image, { x: px + dx - 3, y: py + dy - 3, width: 7, height: 7 }, palette.inkDark)
      }
      for (const [px, py] of house.points) paint(image, { x: px + dx, y: py + dy, width: 1, height: 1 }, owner.anchor)
      if (ordinals[index] === null) continue
      const badge = { ...source, data: source.data.slice() }
      if (ordinals[index] === 2) {
        paint(badge, { x: 480, y: 1322, width: 6, height: 17 }, palette.tokenCream)
      }
      copy(image, { x: 465, y: 1312, width: 36, height: 36 }, 465 + dx, 1312 + dy, badge)
      if (ordinals[index] === 2) {
        for (const shift of [-4, 5]) {
          copy(image, { x: 480, y: 1322, width: 6, height: 17 }, 480 + dx + shift, 1322 + dy, source)
        }
      }
    }
    return { image, palette, registration, owners }
  }

  it('emits first picks in turn order, then second picks in reverse turn order', () => {
    const { image, palette, registration, owners } = scene([2, 2, 1, 1])
    const pieces = orderDraftSettlements(
      image, palette, registration, detectPieces(image, palette, registration, owners).buildings,
      owners.map((owner) => owner.id),
    )
    expect(pieces.buildings.map((building) => building.vertexId)).toEqual([vertices[3], vertices[2], vertices[1], vertices[0]])
    expect(pieces.unorderedPlayerIds).toEqual([])
     // Every pair was ordered by its badges, so an update may take this order.
    const parsed = parseScreenshot(image)
    expect(parsed.ok && parsed.read.picks).toBe(true)
  })

  it.each([
    [1, null, false],
    [null, 1, true],
    [2, null, true],
    [null, 2, false],
  ] as const)('orders a pair from badges %s and %s', (first, second, reversed) => {
    const { image, palette, registration, owners } = scene([first, 2, 1, second])
    const pieces = orderDraftSettlements(
      image, palette, registration, detectPieces(image, palette, registration, owners).buildings,
      owners.map((owner) => owner.id),
    )
    const white = pieces.buildings.filter((building) => building.playerId === 'p1')
    expect(white.map((building) => building.vertexId)).toEqual(reversed ? [vertices[3], vertices[0]] : [vertices[0], vertices[3]])
    expect(pieces.unorderedPlayerIds).toEqual([])
  })

  it('does not warn about settlement order on a board containing a city', () => {
    const { image, palette, registration, owners } = scene([null, null, null, null])
    const [x, y] = vertexPoint(registration, vertices[1]).map(Math.round)
    paint(image, { x: x - 27, y: y - 27, width: 55, height: 55 }, palette.inkDark)
    paint(image, { x: x - 24, y: y - 24, width: 49, height: 49 }, palette.player.brown)
    const pieces = orderDraftSettlements(
      image, palette, registration, detectPieces(image, palette, registration, owners).buildings,
      owners.map((owner) => owner.id),
    )
    expect(pieces.buildings.find((building) => building.vertexId === vertices[1])?.tier).toBe('city')
    expect(pieces.unorderedPlayerIds).toEqual([])
    // No badge ordered anything, so an update keeps the saved order.
    const parsed = parseScreenshot(image)
    expect(parsed.ok && parsed.read.picks).toBe(false)
  })

  it('does not warn about missing badges once every roster player has two settlements', () => {
    const { image } = scene([null, null, null, null, null, null], true)
    const parsed = parseScreenshot(image)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.game.board.players).toHaveLength(3)
    for (const player of parsed.game.board.players) {
      expect(parsed.game.board.buildings.filter((building) => building.playerId === player.id && building.tier === 'settlement')).toHaveLength(2)
    }
    expect(parsed.issues.filter((issue) => issue.stage === 'pieces')).toEqual([])
     expect(parsed.read.picks).toBe(false)
  })

  it('retains each player\'s scan order and warns when neither badge can be read', () => {
    const { image, palette, registration, owners } = scene([null, null, null, null])
    const pieces = orderDraftSettlements(
      image, palette, registration, detectPieces(image, palette, registration, owners).buildings,
      owners.map((owner) => owner.id),
    )
    expect(pieces.buildings.map((building) => building.vertexId)).toEqual([vertices[0], vertices[1], vertices[2], vertices[3]])
    expect(pieces.unorderedPlayerIds).toEqual(['p1', 'p2'])
    const parsed = parseScreenshot(image)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.issues.filter((issue) => issue.stage === 'pieces').map((issue) => issue.message)).toEqual([
      'Could not determine settlement order for White',
      'Could not determine settlement order for Brown',
    ])
  })
})
