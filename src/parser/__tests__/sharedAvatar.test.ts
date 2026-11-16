import { expect, it } from 'vitest'
import { parseScreenshot } from '../index'
import { copy, load } from './pillPixels'

it.each([
  { label: 'two identical photos', targets: [{ x: 890, y: 331 }], shift: 0, kept: ['p1', 'p4', 'p5'] },
  { label: 'two similar photos', targets: [{ x: 890, y: 331 }], shift: 3, kept: ['p1', 'p4', 'p5'] },
  { label: 'three identical photos', targets: [{ x: 890, y: 331 }, { x: 399, y: 445 }], shift: 0, kept: ['p1', 'p5'] },
])('omits every shared avatar for $label, keeping the other players', ({ targets, shift, kept }) => {
  const image = load('settled-5p-draft-start')
  const original = parseScreenshot(image)
  if (!original.ok) throw new Error(original.error)
  for (const target of targets) {

    // Copy the second pill's photo disc, including its full middle-row span.
    copy(image, { x: 563, y: 331, width: 66, height: 66 }, target.x, target.y)
    for (let y = target.y; y < target.y + 66; y += 1) {
      for (let x = target.x; x < target.x + 66; x += 1) {
        const red = (y * image.width + x) * 4
        image.data[red] = Math.min(255, image.data[red] + shift)
      }
    }
  }
  const parsed = parseScreenshot(image)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.game.board.players).toEqual(original.game.board.players)
  expect(parsed.game.avatars).toEqual(Object.fromEntries(kept.map((id) => [id, original.game.avatars![id]])))
})
