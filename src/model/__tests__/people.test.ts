import { describe, expect, it } from 'vitest'
import { createBoard } from '../board'
import { newGame, withBoard, type Game } from '../game'
import { assignPrint, identify, joinTarget, namePlayers, PRINT_CUTOFF, printDistance, renamePerson, type Person } from '../people'
import { PLAYER_PALETTE } from '../types'

// A 192-value print (8x8 RGB, two hex digits each) whose values are base + offset, wrapping at 256.
const print = (base: number, spread = 3): string =>
  Array.from({ length: 192 }, (_, index) => ((base + (index % spread) * 40) % 256).toString(16).padStart(2, '0')).join('')

const ALICE = print(10)
const ALICE_NEAR = print(15)
const BOB = print(120)
const CAROL = print(200)

function photographed(names: [name: string, color: string, avatar: string | null][]): Game {
  const board = {
    ...createBoard('standard4'),
    players: names.map(([name, color], index) => ({ id: `p${index + 1}`, name, color })),
    mePlayerId: null,
  }
  const game = newGame(board)
  const avatars = Object.fromEntries(names.flatMap(([, , avatar], index) => avatar === null ? [] : [[`p${index + 1}`, avatar]]))
  return { ...game, avatars }
}

describe('print distance', () => {
  it('is the mean absolute difference per value', () => {
    expect(printDistance(ALICE, ALICE)).toBe(0)
    expect(printDistance(ALICE, ALICE_NEAR)).toBe(5)
    expect(printDistance(ALICE, BOB)).toBeGreaterThan(PRINT_CUTOFF)
  })
})

describe('identify', () => {
  const people: Person[] = [{ name: 'alice', prints: [BOB, ALICE] }, { name: 'bob', prints: [print(110)] }]
  it('takes the identity with the closest print under the cutoff', () => {
    expect(identify(people, ALICE_NEAR)?.name).toBe('alice')
    expect(identify(people, print(118))?.name).toBe('alice')
    expect(identify(people, print(112))?.name).toBe('bob')
  })
  it('finds nobody past the cutoff', () => {
    expect(identify(people, CAROL)).toBeNull()
    expect(identify([], ALICE)).toBeNull()
  })
})

describe('namePlayers', () => {
  const people: Person[] = [{ name: 'alice', prints: [ALICE] }, { name: 'bob', prints: [BOB] }]
  it.each([' Player 3 ', 'pLaYeR 12', ' blue '])('recognises a photographed player named %s regardless of their colour', (name) => {
    const game = photographed([[name, PLAYER_PALETTE.red, ALICE]])
    expect(namePlayers(game, people).board.players[0].name).toBe('alice')
  })
  it('names default-named photographed players and leaves the rest', () => {
    const game = photographed([
      ['Red', PLAYER_PALETTE.red, ALICE_NEAR],
      ['Blue', PLAYER_PALETTE.blue, CAROL],
      ['White', PLAYER_PALETTE.white, null],
      ['Zed', PLAYER_PALETTE.orange, BOB],
    ])
    expect(namePlayers(game, people).board.players.map((player) => player.name)).toEqual(['alice', 'Blue', 'White', 'Zed'])
  })
  it('names nobody when two players resolve to one identity', () => {
    const game = photographed([['Red', PLAYER_PALETTE.red, ALICE], ['Blue', PLAYER_PALETTE.blue, ALICE_NEAR], ['White', PLAYER_PALETTE.white, BOB]])
    expect(namePlayers(game, people).board.players.map((player) => player.name)).toEqual(['Red', 'Blue', 'bob'])
  })
  it('skips a name another seat already holds', () => {
    const game = photographed([['alice', PLAYER_PALETTE.red, null], ['Blue', PLAYER_PALETTE.blue, ALICE]])
    expect(namePlayers(game, people).board.players.map((player) => player.name)).toEqual(['alice', 'Blue'])
  })
  it('returns the same game when nothing changes', () => {
    const game = photographed([['Red', PLAYER_PALETTE.red, CAROL]])
    expect(namePlayers(game, people)).toBe(game)
  })
})

describe('assignPrint', () => {
  it('creates an identity for a new name', () => {
    expect(assignPrint([], ALICE, ' alice ')).toEqual([{ name: 'alice', prints: [ALICE] }])
  })
  it('joins an existing identity case-insensitively and leaves the old one', () => {
    const people: Person[] = [{ name: 'Alice', prints: [ALICE] }, { name: 'bob', prints: [BOB, print(110)] }]
    expect(assignPrint(people, BOB, 'ALICE')).toEqual([{ name: 'Alice', prints: [ALICE, BOB] }, { name: 'bob', prints: [print(110)] }])
  })
  it('updates the spelling of the print\'s own identity to the trimmed name', () => {
    const people: Person[] = [{ name: 'alice', prints: [ALICE] }]
    expect(assignPrint(people, ALICE_NEAR, ' Alice ')).toEqual([{ name: 'Alice', prints: [ALICE, ALICE_NEAR] }])
    expect(people).toEqual([{ name: 'alice', prints: [ALICE] }])
  })
  it('deletes an identity left without prints', () => {
    const people: Person[] = [{ name: 'alice', prints: [ALICE] }]
    expect(assignPrint(people, ALICE_NEAR, 'ally')).toEqual([{ name: 'ally', prints: [ALICE_NEAR] }])
  })
  it('does not mutate its input', () => {
    const people: Person[] = [{ name: 'alice', prints: [ALICE] }]
    assignPrint(people, BOB, 'alice')
    expect(people).toEqual([{ name: 'alice', prints: [ALICE] }])
  })
})

describe('joinTarget', () => {
  const people: Person[] = [{ name: 'alice', prints: [ALICE] }, { name: 'bob', prints: [BOB] }]
  it('is the other identity a rename would join', () => {
    expect(joinTarget(people, BOB, 'Alice')?.name).toBe('alice')
    expect(joinTarget(people, CAROL, 'alice')?.name).toBe('alice')
  })
  it('is null for a new name or the print\'s own identity', () => {
    expect(joinTarget(people, BOB, 'carol')).toBeNull()
    expect(joinTarget(people, ALICE_NEAR, 'ALICE')).toBeNull()
  })
})

describe('renamePerson', () => {
  it('renames an identity with all its prints, preserving their order and the input', () => {
    const people: Person[] = [{ name: 'Alice', prints: [ALICE, ALICE_NEAR] }, { name: 'bob', prints: [BOB] }]
    const renamed = renamePerson(people, ' ALICE ', ' Ally ')
    expect(renamed).toEqual([{ name: 'Ally', prints: [ALICE, ALICE_NEAR] }, people[1]])
    expect(identify(renamed, ALICE)?.name).toBe('Ally')
    expect(identify(renamed, ALICE_NEAR)?.name).toBe('Ally')
    expect(people).toEqual([{ name: 'Alice', prints: [ALICE, ALICE_NEAR] }, { name: 'bob', prints: [BOB] }])
  })
})

describe('avatars in a game', () => {
  it('drops a removed player\'s fingerprint', () => {
    const game = photographed([['Red', PLAYER_PALETTE.red, ALICE], ['Blue', PLAYER_PALETTE.blue, BOB]])
    const next = withBoard(game, { ...game.board, players: game.board.players.slice(0, 1) })
    expect(next.avatars).toEqual({ p1: ALICE })
  })
})
