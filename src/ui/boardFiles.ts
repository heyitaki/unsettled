// Shared board-file helpers: title derivation for JSON import and export and
// the map library, the comparison behind "this tab holds work the library does
// not", the no-prompt save behind the autosave, and the terrain match behind
// "this screenshot is a board the app already holds".

import { terrainKey, validateBoard } from '../model/board'
import type { Game } from '../model/game'
import { firstFreeName } from '../model/names'
import { gameSignature, isFreshGame, type ParseGameResult } from '../model/serialization'
import type { Board } from '../model/types'
import {
  type ListedMap, listMaps, loadMap, loadMaps, readLibrary, saveMap, takenMapNames, updateMap,
} from '../persistence/localStorage'
import { sortMaps } from './library'

export function fileTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || name
}

/**
 * The first `Board n` that neither an open board nor a saved map carries. The
 * store's own default only knows the open boards, so a map that is saved but
 * not open would get a second row under its name.
 */
export function newBoardTitle(tabs: readonly { title: string }[]): string {
  const taken = takenMapNames()
  for (const tab of tabs) taken.add(tab.title)
  let index = 1
  while (taken.has(`Board ${index}`)) index += 1
  return `Board ${index}`
}

/**
 * The library map a save writes back into, and the name it writes there — or
 * null when the save should add a new map instead.
 *
 * Identity is the id: only a real link counts, or an unlinked tab would
 * silently overwrite a library entry that has no id yet. The name is whatever
 * the map is called now, not the tab's title, so a rename that landed in
 * another window cannot fork the map in two.
 */
export function inPlaceTarget(
  maps: readonly { id: string | null; name: string }[],
  mapId: string | null,
): { id: string; name: string } | null {
  if (mapId === null) return null
  const map = maps.find((candidate) => candidate.id === mapId)
  if (map === undefined || map.id === null) return null
  return { id: map.id, name: map.name }
}

/** What the library holds for a tab: nothing, a game, or no longer anything. */
export type SavedMap =
  | { linked: false }
  | { linked: true; game: Game | null }

/** A library lookup that may have found nothing, as a SavedMap. */
export const savedMap = (result: ParseGameResult | undefined): SavedMap =>
  ({ linked: true, game: result?.ok === true ? result.game : null })

/**
 * Does the library differ from what this tab holds, so that an autosave has
 * something to write? A linked tab whose map has vanished is dirty whatever it
 * holds, because it is then the only copy left. An unlinked tab is dirty once
 * it holds anything beyond a fresh board.
 */
export function tabIsDirty(game: Game, saved: SavedMap): boolean {
  if (!saved.linked) return !isFreshGame(game)
  return saved.game === null || gameSignature(saved.game) !== gameSignature(game)
}

export type SaveTabResult =
  // `evicted`: the maps the library cap dropped to make room for a new entry.
  | { ok: true; id: string; name: string; evicted?: readonly string[] }
  | { ok: false; error: string; quota?: true }

/**
 * Save a tab into the library, with no prompt: the autosave has no name field
 * to answer with and nowhere to put the answer. It writes back into the tab's
 * own map where there is one, and otherwise adds an entry, never over one
 * that already holds the name. `keep` names maps the library cap must not
 * evict to make room: the ones this document still owes a write to.
 */
export function saveTab(
  tab: { title: string; game: Game; mapId: string | null },
  keep: ReadonlySet<string> = new Set(),
): SaveTabResult {
  const wanted = tab.title.trim()
  if (wanted.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const library = readLibrary()
  // An unreadable library holds no addressable maps, so a save there is a fresh
  // entry — and saveMap is what moves the corrupt blob aside.
  const maps = library.readable ? library.maps : []
  // Under the map's own name, not the tab's title: a save is not a rename, and
  // inPlaceTarget is where that rule lives for every save path.
  const inPlace = inPlaceTarget(maps, tab.mapId)
  if (inPlace !== null) {
    const updated = updateMap(inPlace.id, inPlace.name, tab.game)
    return updated.ok ? { ok: true, id: updated.id, name: inPlace.name } : updated
  }
  // A new entry: an unlinked tab, or a linked one whose map was deleted
  // meanwhile and which now holds the only copy of the board. It lands beside a
  // name that is taken rather than replacing it, because a save with no prompt
  // is never permission to overwrite somebody else's map. The names come from
  // the writer's own rule, not from the library view: an entry saveMap would
  // refuse over but readLibrary cannot address would otherwise be invisible
  // here and fatal one line later, with no prompt to resolve it.
  const name = firstFreeName(wanted, takenMapNames())
  const result = saveMap(name, tab.game, keep)
  if (!result.ok) return result
  return { ok: true, id: result.id, name, ...(result.evicted === undefined ? {} : { evicted: result.evicted }) }
}

type LinkedTab = { mapId: string | null; game: Game }

/**
 * The game a library map holds now: its open tab's, which can be ahead of the
 * autosave, else the stored one. Null when there is neither.
 */
export function mapGame(mapId: string | null, tabs: readonly LinkedTab[]): Game | null {
  if (mapId === null) return null
  const open = tabs.find((tab) => tab.mapId === mapId)
  if (open !== undefined) return open.game
  const stored = loadMap(mapId)
  return stored.ok ? stored.game : null
}

/** A board the app already holds: a library map, or an open board in no map yet. */
export type HeldBoard = { map: ListedMap } | { tab: { id: string; title: string } }

/**
 * The board the app already holds with this terrain, or null. Library maps come
 * first, the most recently modified when several share the terrain. Then the
 * open boards in no map, newest first: an import is not written to the library
 * until its first edit, so a second screenshot of that game finds it only here.
 */
export function matchingBoard(
  board: Board,
  tabs: readonly (LinkedTab & { id: string; title: string })[],
): HeldBoard | null {
  const key = terrainKey(board)
  // A row with a made-up name cannot be linked to a tab, so it cannot be updated.
  const maps = sortMaps(listMaps().maps, 'modifiedAt').filter((map) => map.synthetic !== true)
  // One pass over the store, so the lookups below are all cache hits.
  loadMaps(maps.flatMap((map) => map.id ?? []))
  const map = maps.find((candidate) => {
    const game = mapGame(candidate.id, tabs)
    return game !== null && terrainKey(game.board) === key
  })
  if (map !== undefined) return { map }
  const tab = tabs.findLast((candidate) => candidate.mapId === null && terrainKey(candidate.game.board) === key)
  return tab === undefined ? null : { tab: { id: tab.id, title: tab.title } }
}

// The board's non-blocking warnings as a clause, or null when it has none.
export function loadWarnings(board: Parameters<typeof validateBoard>[0]): string | null {
  const warnings = validateBoard(board).filter((issue) => issue.severity === 'warning')
  if (warnings.length === 0) return null
  const messages = [...new Set(warnings.map((warning) => warning.message))]
  return `with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${messages.join('; ')}`
}

// Summarizes any non-blocking warnings so a load/import notice surfaces them.
export function loadedNotice(action: string, board: Parameters<typeof validateBoard>[0]): string {
  const warnings = loadWarnings(board)
  return warnings === null ? action : `${action} ${warnings}`
}

export function downloadBoard(name: string, contents: string) {
  if (import.meta.env.MODE === 'native') {
    void import('../native/ios').then((ios) => ios.saveFile(name || 'board', '.catan.json', contents))
    return
  }
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || 'board'}.catan.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
