import type { Game } from '../model/game'
import { parseGame, serializeGame, type ParseGameResult } from '../model/serialization'
import { newId } from '../model/ids'

export const MAPS_KEY = 'unsettled.maps.v1'
export const CURRENT_KEY = 'unsettled.current.v1'
export const MAPS_CORRUPT_KEY = `${MAPS_KEY}.corrupt`
export const WORKSPACE_KEY = 'unsettled.workspace.v1'
// Session-scoped, so it is per browser tab and fires no cross-document events.
export const ACTIVE_TAB_KEY = 'unsettled.activeTab.v1'
export const WORKSPACE_CORRUPT_KEY = `${WORKSPACE_KEY}.corrupt`

export interface ListedMap {
  // Stable identity, minted on first write and preserved across renames and
  // overwrites. Null only for entries with no name, which nothing can address.
  id: string | null
  // Position in the stored array. The one handle onto an entry that has no id
  // yet, and stable across migrateMapIds, which rewrites entries in place.
  index: number
  name: string
  valid: boolean
  errors?: string[]
  createdAt?: number
  modifiedAt?: number
  openedAt?: number
  // True when `name` is a fabricated placeholder for a malformed entry rather
  // than a real stored name — such entries are not addressable by saveMap.
  synthetic?: boolean
}

export interface WorkspaceTab {
  id: string
  title: string
  game: Game
  activePlayerId?: string
  // The library map this tab is a view of, by map id. Absent for a tab that was
  // never saved to or opened from the library.
  mapId?: string
}

export interface PersistedWorkspace {
  tabs: WorkspaceTab[]
  /**
   * Only ever read, never written: which tab is in front is per-window state,
   * and it lives in ACTIVE_TAB_KEY now. Blobs written before that carry it, and
   * it is still the best cold-start guess for a window with no session of its
   * own, so loading keeps honouring it.
   */
  activeTabId?: string
}

type WriteResult = { ok: true } | { ok: false; error: string }
type SaveMapResult = { ok: true; id: string } | { ok: false; error: string }
const MISSING_MAP = 'That map is no longer in the library'
let corruptMapsBlob: string | null = null
let corruptWorkspaceBlob: string | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNamedMapEntry(entry: unknown): entry is Record<string, unknown> & { name: string } {
  return isRecord(entry) && typeof entry.name === 'string'
}

// An empty string is not an identity: it would compare equal across every
// entry that carries one, so the migration treats it as missing and re-mints.
const mapEntryId = (entry: unknown): string | null =>
  isRecord(entry) && typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : null

// Maps are addressed by id everywhere above this layer: names are a label the
// user can change, ids are what a tab's link points at.
const findMapIndexById = (maps: unknown[], id: string): number =>
  maps.findIndex((entry) => mapEntryId(entry) === id)

// Entries written before games existed stored a bare `board`; parseGame wraps
// those with zero-filled stats, so both shapes stay loadable forever.
const entryGame = (entry: Record<string, unknown>): unknown => entry.game ?? entry.board

function readRawMaps(): { entries: unknown[]; warning?: string } {
  return parseRawMaps(localStorage.getItem(MAPS_KEY))
}

// Split from readRawMaps so a caller that already holds the raw text does not
// read the key a second time to parse it.
function parseRawMaps(raw: string | null): { entries: unknown[]; warning?: string } {
  if (raw === null) return { entries: [] }
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) throw new Error('Saved maps must be an array')
    return { entries: value }
  } catch (error) {
    corruptMapsBlob = raw
    return { entries: [], warning: error instanceof Error ? error.message : 'Corrupted saved maps' }
  }
}

function writeMaps(maps: unknown[]): WriteResult {
  try {
    if (corruptMapsBlob !== null) {
      localStorage.setItem(MAPS_CORRUPT_KEY, corruptMapsBlob)
      corruptMapsBlob = null
    }
    localStorage.setItem(MAPS_KEY, JSON.stringify(maps))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to write localStorage' }
  }
}

/**
 * Stamp an id on every named entry that lacks a usable one, so maps saved
 * before ids existed become linkable. Deliberately additive and one-shot:
 * entries with no name are unaddressable and left byte-identical, and a store
 * whose ids are already unique is not rewritten at all.
 */
export function migrateMapIds(): WriteResult {
  const maps = readRawMaps().entries
  const seen = new Set<string>()
  let changed = false
  const migrated = maps.map((entry) => {
    const id = mapEntryId(entry)
    if (id !== null && !seen.has(id)) {
      seen.add(id)
      return entry
    }
    // A repeated id is worse than none: two rows sharing one address as each
    // other, so opening the second yields the first. Nothing can be done for an
    // entry with no name — it is unaddressable either way — so it is left be.
    if (!isNamedMapEntry(entry)) return entry
    changed = true
    // Minted id last: an entry carrying a non-string or duplicate `id` must
    // lose it, or it stays unaddressable and marks the store dirty every launch.
    const minted = newId()
    seen.add(minted)
    return { ...entry, id: minted }
  })
  return changed ? writeMaps(migrated) : { ok: true }
}

/**
 * What the library holds, for callers that need identity rather than content.
 * `readable: false` means the blob did not parse, which is emphatically not the
 * same as an empty library: treating it as empty would unlink every tab and
 * then persist that. Deliberately skips parseGame — a name and an id cost
 * nothing, while validating every stored board runs on each library refresh.
 */
export type LibraryView =
  | { readable: false }
  | { readable: true; maps: readonly { id: string; name: string }[] }

export function readLibrary(): LibraryView {
  const raw = readRawMaps()
  if (raw.warning !== undefined) return { readable: false }
  const maps: { id: string; name: string }[] = []
  for (const entry of raw.entries) {
    const id = mapEntryId(entry)
    // An entry with no name is unaddressable, so nothing can be linked to it.
    if (id !== null && isNamedMapEntry(entry)) maps.push({ id, name: entry.name })
  }
  return { readable: true, maps }
}

/**
 * Every name a save would collide with — by the same predicate saveMap refuses
 * on, which is deliberately not readLibrary's. An entry can carry a name and no
 * id (written before ids, and left that way by a failed migration): unaddressable,
 * so absent from the library view, yet still enough to make saveMap refuse. A
 * caller picking a free name has to see those, or it picks one that is taken.
 */
export function takenMapNames(): Set<string> {
  const names = new Set<string>()
  for (const entry of readRawMaps().entries) {
    if (isNamedMapEntry(entry)) names.add(entry.name)
  }
  return names
}

export function listMaps(): { maps: ListedMap[]; warning?: string } {
  const raw = readRawMaps()
  const maps: ListedMap[] = raw.entries.map((entry, index) => {
    if (!isRecord(entry)) {
      return {
        id: null,
        index,
        name: `Invalid map ${index + 1}`,
        valid: false,
        errors: ['Entry must be an object'],
        synthetic: true,
      }
    }
    const hasName = typeof entry.name === 'string'
    const name = hasName ? entry.name as string : `Invalid map ${index + 1}`
    const timestamps = {
      ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
      ...(typeof entry.modifiedAt === 'number' ? { modifiedAt: entry.modifiedAt } : {}),
      ...(typeof entry.openedAt === 'number' ? { openedAt: entry.openedAt } : {}),
    }
    const parsed = parseGame(entryGame(entry))
    const base = parsed.ok
      ? { id: mapEntryId(entry), index, name, valid: true, ...timestamps }
      : { id: mapEntryId(entry), index, name, valid: false, errors: parsed.errors, ...timestamps }
    return hasName ? base : { ...base, synthetic: true }
  })
  return { maps, ...(raw.warning ? { warning: raw.warning } : {}) }
}

// The stored shape of a map, rebuilt from whatever the entry being replaced
// already held. Shared by both writers so the two cannot drift apart.
function mapEntry(name: string, game: Game, existing: Record<string, unknown> | null) {
  const now = Date.now()
  return {
    id: (existing && mapEntryId(existing)) ?? newId(),
    name,
    game,
    createdAt: existing && typeof existing.createdAt === 'number' ? existing.createdAt : now,
    modifiedAt: now,
    openedAt: existing && typeof existing.openedAt === 'number' ? existing.openedAt : now,
  }
}

/**
 * Write `game` under `name`, returning the id of the entry it landed in.
 * Overwriting an existing name keeps that entry's id, so a tab linked to the
 * map stays linked; a fresh name mints a new id.
 */
export function saveMap(name: string, game: Game, overwrite = false): SaveMapResult {
  if (name.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const maps = [...readRawMaps().entries]
  const index = maps.findIndex((entry) => isNamedMapEntry(entry) && entry.name === name)
  if (index >= 0 && !overwrite) return { ok: false, error: 'A map with this name already exists' }
  const entry = mapEntry(name, game, index >= 0 && isRecord(maps[index]) ? maps[index] : null)
  if (index >= 0) maps[index] = entry
  else maps.push(entry)
  const result = writeMaps(maps)
  return result.ok ? { ok: true, id: entry.id } : result
}

/**
 * Write `game` into the map with this id, under `name`. Addressed by id rather
 * than by name, which is what keeps a tab saving back into its own map: if the
 * map was renamed in another window, a name-addressed write would miss it and
 * fork the map in two.
 */
export function updateMap(id: string, name: string, game: Game): SaveMapResult {
  if (name.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const maps = [...readRawMaps().entries]
  const index = findMapIndexById(maps, id)
  if (index < 0) return { ok: false, error: MISSING_MAP }
  const clash = maps.some((entry, at) =>
    at !== index && isNamedMapEntry(entry) && entry.name === name)
  if (clash) return { ok: false, error: 'A map with this name already exists' }
  maps[index] = mapEntry(name, game, maps[index] as Record<string, unknown>)
  const result = writeMaps(maps)
  return result.ok ? { ok: true, id } : result
}

export function markMapOpened(id: string): WriteResult {
  const maps = [...readRawMaps().entries]
  const index = findMapIndexById(maps, id)
  if (index < 0) return { ok: true }
  maps[index] = { ...maps[index] as Record<string, unknown>, openedAt: Date.now() }
  return writeMaps(maps)
}

export function renameMap(id: string, newName: string): WriteResult {
  if (newName.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const maps = [...readRawMaps().entries]
  const index = findMapIndexById(maps, id)
  if (index < 0) return { ok: false, error: MISSING_MAP }
  if ((maps[index] as Record<string, unknown>).name === newName) return { ok: true }
  if (maps.some((entry) => isNamedMapEntry(entry) && entry.name === newName)) {
    return { ok: false, error: 'A map with this name already exists' }
  }
  maps[index] = { ...maps[index] as Record<string, unknown>, name: newName }
  return writeMaps(maps)
}

// Parsed games, keyed by the exact blob they came from. The tab strip compares
// every linked tab against its saved map on each render, and parseGame runs a
// full board validation — without this, editing a board re-validates the whole
// library per keystroke. Every write goes through writeMaps, so a changed blob
// means a changed string, which makes the raw text a sound key.
let parsedGames: { raw: string | null; games: Map<string, ParseGameResult> } | null = null

const missingMap = (): ParseGameResult => ({ ok: false, errors: [MISSING_MAP] })

export function loadMap(id: string): ParseGameResult {
  return loadMaps([id]).get(id) ?? missingMap()
}

/**
 * Load several maps in one pass over the store, answering for every id it was
 * given — including ones the library no longer has.
 */
export function loadMaps(ids: readonly string[]): Map<string, ParseGameResult> {
  const wanted = new Set(ids)
  const loaded = new Map<string, ParseGameResult>()
  if (wanted.size === 0) return loaded
  const raw = localStorage.getItem(MAPS_KEY)
  if (parsedGames === null || parsedGames.raw !== raw) parsedGames = { raw, games: new Map() }
  const cache = parsedGames.games
  const missing = [...wanted].filter((id) => !cache.has(id))
  if (missing.length > 0) {
    const needed = new Set(missing)
    for (const entry of parseRawMaps(raw).entries) {
      const id = mapEntryId(entry)
      if (id === null || !needed.has(id) || cache.has(id)) continue
      cache.set(id, parseGame(entryGame(entry as Record<string, unknown>)))
    }
    for (const id of needed) if (!cache.has(id)) cache.set(id, missingMap())
  }
  for (const id of wanted) loaded.set(id, cache.get(id) ?? missingMap())
  return loaded
}

export function deleteMap(id: string): WriteResult {
  const entries = readRawMaps().entries
  const index = findMapIndexById(entries, id)
  // Deleting nothing is reachable — the map may already be gone, removed in
  // another document — and rewriting the whole library for it is pure cost.
  if (index < 0) return { ok: true }
  // One row, never every row that answers to the id: hand-edited or foreign
  // data can repeat an id, and deleting a map must not take another with it.
  return writeMaps(entries.filter((_, at) => at !== index))
}

export function autosaveCurrent(game: Game): WriteResult {
  try {
    localStorage.setItem(CURRENT_KEY, serializeGame(game))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to autosave' }
  }
}

export function loadCurrent(): ParseGameResult {
  const value = localStorage.getItem(CURRENT_KEY)
  return value === null ? { ok: false, errors: ['No autosave found'] } : parseGame(value)
}

/**
 * The exact bytes a workspace persists as. Documents compare blobs to tell an
 * autosave that would change nothing from one that would, and to notice that
 * storage moved since they last looked, so the serialization has to be the one
 * saveWorkspace performs and not a second, subtly different one.
 */
export function workspaceBlob(workspace: PersistedWorkspace): string {
  return JSON.stringify(workspace)
}

/** The stored workspace, unparsed: the blob to compare a write against. */
export function readWorkspaceBlob(): string | null {
  return localStorage.getItem(WORKSPACE_KEY)
}

/**
 * Which tab this window has in front. Session storage, not local: it is the one
 * piece of workspace state that is per-window rather than shared, and keeping it
 * in the shared blob meant two windows looking at different tabs could never
 * agree on the bytes — so every adoption was answered with a rewrite of every
 * board, purely to say which tab the answering window was looking at.
 *
 * A failure here costs the user a tab selection on reload, so it is swallowed
 * rather than surfaced.
 */
export function saveActiveTab(id: string): void {
  try {
    sessionStorage.setItem(ACTIVE_TAB_KEY, id)
  } catch {
    // Session storage is full or blocked; the fallback chain still resolves.
  }
}

export function loadActiveTab(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_TAB_KEY)
  } catch {
    return null
  }
}

/**
 * Tab id → linked map id: the shape every comparison of "what storage holds
 * against what this document shows" is made in, with `mapId` normalised to null
 * so an absent link and a null one cannot read as different.
 */
export function tabLinks(tabs: readonly WorkspaceTab[]): Map<string, string | null> {
  return new Map(tabs.map((tab) => [tab.id, tab.mapId ?? null]))
}

/**
 * Writes an already-serialized workspace. The caller serializes when it needs
 * the bytes for itself — to compare them against what is stored — and passing
 * them through means the bytes it recorded are by construction the bytes that
 * landed, rather than a second stringify that merely ought to agree.
 */
export function saveWorkspaceBlob(blob: string): WriteResult {
  try {
    if (corruptWorkspaceBlob !== null) {
      localStorage.setItem(WORKSPACE_CORRUPT_KEY, corruptWorkspaceBlob)
      corruptWorkspaceBlob = null
    }
    localStorage.setItem(WORKSPACE_KEY, blob)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to autosave workspace' }
  }
}

export function saveWorkspace(workspace: PersistedWorkspace): WriteResult {
  return saveWorkspaceBlob(workspaceBlob(workspace))
}

/**
 * Tab id → linked map id, exactly as the stored workspace holds them, with no
 * game validation. This is what a document can be sure is already in shared
 * storage: anything else it is showing is unflushed local work. Deliberately
 * re-reads the blob rather than deriving from a loaded workspace, because the
 * store reconciles links at startup and those changes are not written yet.
 */
export function storedTabLinks(): Map<string, string | null> {
  const links = new Map<string, string | null>()
  const raw = localStorage.getItem(WORKSPACE_KEY)
  if (raw === null) return links
  let value: unknown
  // A blob that does not parse holds nothing this document can claim to have
  // written; loadWorkspace is the one that records it for recovery.
  try {
    value = JSON.parse(raw)
  } catch {
    return links
  }
  if (!isRecord(value) || !Array.isArray(value.tabs)) return links
  for (const entry of value.tabs) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    links.set(entry.id, typeof entry.mapId === 'string' ? entry.mapId : null)
  }
  return links
}

export function loadWorkspace():
  | { ok: true; workspace: PersistedWorkspace; warning?: string }
  | { ok: false } {
  const raw = localStorage.getItem(WORKSPACE_KEY)
  if (raw === null) {
    const current = loadCurrent()
    if (!current.ok) return { ok: false }
    const id = newId()
    return {
      ok: true,
      workspace: {
        activeTabId: id,
        tabs: [{ id, title: 'Board 1', game: current.game }],
      },
    }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    corruptWorkspaceBlob = raw
    return { ok: false }
  }
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    corruptWorkspaceBlob = raw
    return { ok: false }
  }

  const invalidTabs: string[] = []
  const tabs: WorkspaceTab[] = []
  const seenIds = new Set<string>()
  let lossy = false
  value.tabs.forEach((entry, index) => {
    const label = isRecord(entry) && typeof entry.title === 'string'
      ? entry.title
      : `Tab ${index + 1}`
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') {
      invalidTabs.push(label)
      lossy = true
      return
    }
    if (seenIds.has(entry.id)) {
      invalidTabs.push(label)
      lossy = true
      return
    }
    const parsed = parseGame(entryGame(entry))
    if (!parsed.ok) {
      invalidTabs.push(label)
      lossy = true
      return
    }
    seenIds.add(entry.id)
    const activePlayerId = typeof entry.activePlayerId === 'string' &&
      parsed.game.board.players.some((player) => player.id === entry.activePlayerId)
      ? entry.activePlayerId
      : undefined
    if (entry.activePlayerId !== undefined && activePlayerId === undefined) lossy = true
    // A link to a map that has since been deleted is not a load-time error: the
    // store reconciles dangling links against the library and unlinks the tab.
    const mapId = typeof entry.mapId === 'string' ? entry.mapId : undefined
    if (entry.mapId !== undefined && mapId === undefined) lossy = true
    tabs.push({
      id: entry.id,
      title: entry.title,
      game: parsed.game,
      ...(activePlayerId === undefined ? {} : { activePlayerId }),
      ...(mapId === undefined ? {} : { mapId }),
    })
  })

  if (lossy) corruptWorkspaceBlob = raw
  if (tabs.length === 0) {
    corruptWorkspaceBlob = raw
    return { ok: false }
  }
  // A blob with no active tab is the normal shape now, and one naming a tab
  // this window cannot see is an ordinary disagreement between windows, not
  // damage — neither is worth preserving a corrupt copy over.
  const hasActiveTab = typeof value.activeTabId === 'string' &&
    tabs.some((tab) => tab.id === value.activeTabId)
  const workspace: PersistedWorkspace = hasActiveTab
    ? { tabs, activeTabId: value.activeTabId as string }
    : { tabs }
  return invalidTabs.length > 0
    ? { ok: true, workspace, warning: `Ignored invalid workspace tabs: ${invalidTabs.join(', ')}` }
    : { ok: true, workspace }
}
