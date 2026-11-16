import { expect, it } from 'vitest'
import { type RgbaImage } from '../image'
import { registerBoard } from '../registration'
import { choosePalette } from '../sources/settled/palette'
import { detectRoster } from '../sources/settled/pills'
import { load, paint } from './pillPixels'

it('fingerprints the whole photo equally when a highlighted border shrinks the pill fill', () => {
  const fixture = load()
  const palette = choosePalette(fixture)!
  const registration = registerBoard(fixture, palette)!
  const avatar = (highlighted: boolean) => {
    const image: RgbaImage = { width: 400, height: 150, data: new Uint8ClampedArray(400 * 150 * 4) }
    paint(image, { x: 0, y: 0, width: image.width, height: image.height }, palette.bgBlue)
    const height = highlighted ? 77 : 83
    const centerY = 20 + Math.floor(height / 2)
    paint(image, { x: 20, y: 20, width: 301, height }, highlighted ? palette.pillHighlight : palette.chipCream)
    paint(image, { x: 38, y: centerY - 8, width: 16, height: 16 }, palette.player.red)

    // The photo stays the same size while the highlighted pill's fill loses six pixels.
    for (let dy = -29; dy <= 29; dy += 1) {
      for (let dx = -29; dx <= 29; dx += 1) {
        if (dx * dx + dy * dy <= 29 ** 2) {
          paint(image, { x: 114 + dx, y: centerY + dy, width: 1, height: 1 }, [100 + 2 * dx, 100 + 2 * dy, 60])
        }
      }
    }
    const roster = detectRoster(image, palette, { ...registration, bandTop: image.height })
    expect(roster.players).toHaveLength(1)
    expect(roster.turnPlayerId).toBe(highlighted ? 'p1' : null)
    expect(roster.players[0].avatar).toMatch(/^[0-9a-f]{384}$/)
    return roster.players[0].avatar
  }
  expect(avatar(true)).toBe(avatar(false))
})
