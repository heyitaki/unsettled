// Shared board-file helpers: title derivation for the import/export panel and
// the map library, plus the comparison behind "this tab has unsaved work".

import { createBoard, validateBoard } from '../model/board'
import { newGame, type Game } from '../model/game'
import { serializeGame, type ParseGameResult } from '../model/serialization'
import type { LayoutId } from '../model/types'

export function fileTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || name
}

// First unused "base (n)" name, so a copy never clobbers an existing map.
export function nextCopyName(base: string, taken: Set<string>): string {
  let index = 1
  while (taken.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

// `base` if free, else the first unused "base (n)", so two open boards never
// read as the same board. Cosmetic only — links are ids, not titles.
export function firstFreeName(base: string, taken: Set<string>): string {
  return taken.has(base) ? nextCopyName(base, taken) : base
}

/**
 * The library map a save writes back into, and the name it writes there — or
 * null when the save should address the library by name instead (a new map, or
 * a replacement of some other map that happens to share the name).
 *
 * Identity is the id: only a real link counts, or an unlinked tab would
 * silently overwrite a library entry that has no id yet. `typedName` is the
 * name the user actually edited, or null for a name field they left following
 * the tab's title — in which case the save adopts whatever the map is called
 * now, so a rename that landed in another window cannot fork it in two.
 */
export function inPlaceTarget(
  maps: readonly { id: string | null; name: string }[],
  mapId: string | null,
  typedName: string | null,
): { id: string; name: string } | null {
  if (mapId === null) return null
  const map = maps.find((candidate) => candidate.id === mapId)
  if (map === undefined || map.id === null) return null
  if (typedName !== null && typedName !== map.name) return null
  return { id: map.id, name: typedName ?? map.name }
}

/** What the library holds for a tab: nothing, a game, or no longer anything. */
export type SavedMap =
  | { linked: false }
  | { linked: true; game: Game | null }

/** A library lookup that may have found nothing, as a SavedMap. */
export const savedMap = (result: ParseGameResult | undefined): SavedMap =>
  ({ linked: true, game: result?.ok === true ? result.game : null })

// Serialized games, keyed by game identity. Games are immutable and replaced
// wholesale by the reducer, so this is exact — and it keeps the tab strip from
// re-serializing every open board on every edit.
const signatures = new WeakMap<Game, string>()

function signature(game: Game): string {
  const cached = signatures.get(game)
  if (cached !== undefined) return cached
  const value = serializeGame(game)
  signatures.set(game, value)
  return value
}

// One blank board per layout, rather than building and serializing a throwaway
// baseline for every unlinked tab on every render.
const blanks = new Map<LayoutId, string>()

function blankSignature(layout: LayoutId): string {
  const cached = blanks.get(layout)
  if (cached !== undefined) return cached
  const value = serializeGame(newGame(createBoard(layout)))
  blanks.set(layout, value)
  return value
}

/**
 * Does closing this tab lose work? A linked tab whose map has vanished is dirty
 * whatever it holds, because it is then the only copy left. An unlinked tab is
 * dirty once it holds anything beyond a fresh board.
 */
export function tabIsDirty(game: Game, saved: SavedMap): boolean {
  if (!saved.linked) return signature(game) !== blankSignature(game.board.layout)
  return saved.game === null || signature(saved.game) !== signature(game)
}

// Computed for the whole strip in one pass, because every linked tab needs its
// saved counterpart and the library is one blob to parse.
export function dirtyTabIds(
  tabs: readonly { id: string; game: Game; mapId: string | null }[],
  saved: ReadonlyMap<string, ParseGameResult>,
): Set<string> {
  return new Set(
    tabs
      .filter((tab) => tabIsDirty(
        tab.game,
        tab.mapId === null ? { linked: false } : savedMap(saved.get(tab.mapId)),
      ))
      .map((tab) => tab.id),
  )
}

// Summarizes any non-blocking warnings so a load/import notice surfaces them.
export function loadedNotice(action: string, board: Parameters<typeof validateBoard>[0]): string {
  const warnings = validateBoard(board).filter((issue) => issue.severity === 'warning')
  if (warnings.length === 0) return action
  const messages = [...new Set(warnings.map((warning) => warning.message))]
  return `${action} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${messages.join('; ')}`
}

export function downloadBoard(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || 'board'}.catan.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
