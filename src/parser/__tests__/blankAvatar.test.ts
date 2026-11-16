import { expect, it } from 'vitest'
import { identify, type Person } from '../../model/people'
import { parseScreenshot } from '../index'
import { load, nearestScale, paint } from './pillPixels'

it('omits a solid placeholder photo while keeping the other player photo', () => {
  const image = load()

  // The first pill's photo disc is centred at (435, 363), radius 33.
  for (let y = 330; y <= 396; y += 1) {
    for (let x = 402; x <= 468; x += 1) {
      if ((x - 435) ** 2 + (y - 363) ** 2 <= 33 ** 2) paint(image, { x, y, width: 1, height: 1 }, [80, 80, 80])
    }
  }
  const parsed = parseScreenshot(image)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.game.board.players).toHaveLength(2)
  expect(parsed.game.avatars).not.toHaveProperty('p1')
  expect(parsed.game.avatars?.p2).toMatch(/^[0-9a-f]{384}$/)
})

it('recognises photos after scaling a fixture to two thirds', () => {
  const image = load('settled-5p-draft-start')
  const raw = parseScreenshot(image)
  const scaled = parseScreenshot(nearestScale(image, 1.5))
  if (!raw.ok || !scaled.ok) throw new Error('Fixture did not parse')
  const people: Person[] = raw.game.board.players.map(({ id }) => ({ name: id, prints: [raw.game.avatars![id]] }))
  expect(scaled.game.board.players.map(({ id }) => identify(people, scaled.game.avatars![id])?.name))
    .toEqual(raw.game.board.players.map(({ id }) => id))
})
