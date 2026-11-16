import type { Game } from './game'
import { isDefaultName } from './people'
import { isFreshGame } from './serialization'

// `base` if free, else the first unused "base (n)", so two boards never read
// as the same board. Cosmetic only: links are ids, not titles.
export function firstFreeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let index = 1
  while (taken.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

/** Whether `candidate` is a "base (n)" that firstFreeName would have minted for `base`. */
export function isCopyName(base: string, candidate: string): boolean {
  const prefix = `${base} (`
  return candidate.startsWith(prefix) && candidate.endsWith(')') && /^\d+$/.test(candidate.slice(prefix.length, -1))
}

export function automaticTitle(game: Game, created: Date, taken: ReadonlySet<string>): string | null {
  if (game.board.players.every((player) => isDefaultName(player.name)) || isFreshGame(game)) return null
  const base = `${created.getMonth() + 1}/${created.getDate()} ${game.board.players.map((player) => player.name).join(', ')}`
  let title = base
  let index = 2
  while (taken.has(title)) title = `${base} ${index++}`
  return title
}

export const isAutomaticTitle = (title: string): boolean => /^Board \d+$/.test(title) || /^\d{1,2}\/\d{1,2} .+/.test(title)
