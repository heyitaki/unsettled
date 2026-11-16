import type { Game } from './game'
import { PLAYER_PALETTE } from './types'

export interface Person {
  name: string
  prints: string[]
}

export const PRINT_CUTOFF = 20
export const nameKey = (name: string): string => name.trim().toLowerCase()
export const isDefaultName = (name: string): boolean => Object.hasOwn(PLAYER_PALETTE, nameKey(name)) || /^player \d+$/.test(nameKey(name))
export const isPrint = (value: unknown): value is string => typeof value === 'string' && value.length === 384 && /^[0-9a-f]+$/.test(value)

export function printDistance(a: string, b: string): number {
  let sum = 0
  for (let index = 0; index < 384; index += 2) {
    sum += Math.abs(parseInt(a.slice(index, index + 2), 16) - parseInt(b.slice(index, index + 2), 16))
  }
  return sum / 192
}

export function identify(people: readonly Person[], print: string): Person | null {
  let closest: Person | null = null
  let distance = PRINT_CUTOFF
  for (const person of people) {
    for (const known of person.prints) {
      const next = printDistance(known, print)
      if (next < distance) {
        closest = person
        distance = next
      }
    }
  }
  return closest
}

export function namePlayers(game: Game, people: readonly Person[]): Game {
  const players = game.board.players
  const names = players.map((player) => {
    const print = game.avatars?.[player.id]
    return isDefaultName(player.name) && typeof print === 'string'
      ? identify(people, print)?.name ?? null : null
  })
  const named = players.map((player, index) => {
    const name = names[index]
    if (name === null || players.some((other, at) => at !== index && (
      nameKey(other.name) === nameKey(name) || names[at] !== null && nameKey(names[at]) === nameKey(name)
    ))) return player
    return player.name === name ? player : { ...player, name }
  })
  return named.every((player, index) => player === players[index])
    ? game : { ...game, board: { ...game.board, players: named } }
}

export function assignPrint(people: readonly Person[], print: string, name: string): Person[] {
  const target = people.find((person) => nameKey(person.name) === nameKey(name))
  const previous = identify(people, print)
  const nearest = previous?.prints.reduce((closest, candidate) =>
    printDistance(candidate, print) < printDistance(closest, print) ? candidate : closest)
  const next = people.flatMap((person) => {
    if (person === target) return [{
      name: person === previous ? name.trim() : person.name,
      prints: [...new Set([...person.prints, print])],
    }]
    if (person !== previous) return [person]
    const prints = person.prints.filter((known) => known !== nearest)
    return prints.length > 0 ? [{ ...person, prints }] : []
  })
  if (!target) next.push({ name: name.trim(), prints: [print] })
  return next
}

export function joinTarget(people: readonly Person[], print: string, name: string): Person | null {
  const target = people.find((person) => nameKey(person.name) === nameKey(name))
  return target && target !== identify(people, print) ? target : null
}

export function renamePerson(people: readonly Person[], name: string, nextName: string): Person[] {
  return people.map((person) => nameKey(person.name) === nameKey(name)
    ? { ...person, name: nextName.trim() } : person)
}
