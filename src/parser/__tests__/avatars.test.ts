import { describe, expect, it } from 'vitest'
import type { Game } from '../../model/game'
import { identify, PRINT_CUTOFF, printDistance, type Person } from '../../model/people'
import { parseScreenshot } from '../index'
import { load } from './pillPixels'

function parsed(name: string): Game {
  const result = parseScreenshot(load(name))
  if (!result.ok) throw new Error(result.error)
  return result.game
}

const prints = (game: Game) => game.board.players.map((player) => game.avatars?.[player.id])

// The four Settled fixtures show the same five people. The draft-start pills, in
// order, are p1 to p5; each other fixture's pills are listed by who sits there.
describe('Settled profile photo fingerprints', () => {
  const reference = parsed('settled-5p-draft-start')
  const people: Person[] = reference.board.players.map((player) => ({ name: player.id, prints: [reference.avatars![player.id]] }))

  it.each([
    ['settled-5p-draft-start', ['p1', 'p2', 'p3', 'p4', 'p5']],
    ['settled-5p-midgame-hand', ['p5', 'p3', 'p2', 'p4', 'p1']],
    ['settled-3p-pick-cards', ['p3', 'p4', 'p5']],
    ['settled-2p-first-pick', ['p1', 'p3']],
  ])('recognises each face in %s', (name, expected) => {
    const game = parsed(name)
    expect(prints(game).every((print) => typeof print === 'string')).toBe(true)
    expect(prints(game).map((print) => identify(people, print!)?.name ?? null)).toEqual(expected)
  })

  it('keeps different people well past the cutoff', () => {
    const all = prints(reference) as string[]
    for (const [i, a] of all.entries()) {
      for (const b of all.slice(i + 1)) expect(printDistance(a, b)).toBeGreaterThan(PRINT_CUTOFF + 10)
    }
  })

  it('has no fingerprints without pills', () => {
    expect(parsed('board-endgame-pieces').avatars ?? {}).toEqual({})
  })
})
