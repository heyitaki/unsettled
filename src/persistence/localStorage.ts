import type { Game } from '../model/game'
import { isRecord, parseGame, type ParseGameResult } from '../model/serialization'
import { newId } from '../model/ids'

export const MAPS_KEY = 'unsettled.maps.v1'
export const MAPS_CORRUPT_KEY = `${MAPS_KEY}.corrupt`
export const WORKSPACE_KEY = 'unsettled.workspace.v1'
// Session-scoped, so it is per browser tab and fires no cross-document events.
export const ACTIVE_TAB_KEY = 'unsettled.activeTab.v1'
export const WORKSPACE_CORRUPT_KEY = `${WORKSPACE_KEY}.corrupt`

export interface ListedMap {
  // Stable identity, minted on first write and preserved across renames and
  // updates. Null for entries with no usable id.
  id: string | null
  // Position in the stored array, including entries with no usable id.
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
}

type WriteResult = { ok: true } | { ok: false; error: string }
// `evicted`: the ids the cap dropped to make room, present only when it did.
type SaveMapResult = { ok: true; id: string; evicted?: readonly string[] } | { ok: false; error: string }

/** How many maps the library keeps; a save beyond it drops the least recently touched. */
export const MAX_MAPS = 50
const MISSING_MAP = 'That map is no longer in the library'
let corruptMapsBlob: string | null = null
let corruptWorkspaceBlob: string | null = null

function isNamedMapEntry(entry: unknown): entry is Record<string, unknown> & { name: string } {
  return isRecord(entry) && typeof entry.name === 'string'
}

// Empty ids would make unrelated entries share an identity.
const mapEntryId = (entry: unknown): string | null =>
  isRecord(entry) && typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : null

// Maps are addressed by id everywhere above this layer: names are a label the
// user can change, ids are what a tab's link points at.
const findMapIndexById = (maps: unknown[], id: string): number =>
  maps.findIndex((entry) => mapEntryId(entry) === id)

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
 * Every name a save would collide with, including entries with no usable id.
 * Such entries are absent from readLibrary but still reserve their names.
 */
export function takenMapNames(): Set<string> {
  const names = new Set<string>()
  for (const entry of readRawMaps().entries) {
    if (isNamedMapEntry(entry)) names.add(entry.name)
  }
  return names
}

type Listing = { maps: ListedMap[]; warning?: string }

// The listing keyed by the exact blob it came from. Listing validates every
// stored board, and the library panel re-lists after each autosave, so without
// this every edit burst would re-validate the whole library.
let listing: { raw: string | null; result: Listing } | null = null

export function listMaps(): Listing {
  const raw = localStorage.getItem(MAPS_KEY)
  if (listing === null || listing.raw !== raw) listing = { raw, result: buildListing(raw) }
  return listing.result
}

function buildListing(rawText: string | null): Listing {
  const raw = parseRawMaps(rawText)
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
    const parsed = parseGame(entry.game)
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

// The newest stamp an entry carries, so a board that was merely looked at
// counts as touched; an entry with no stamps at all (legacy) is the coldest.
function lastTouched(entry: unknown): number {
  if (!isRecord(entry)) return -Infinity
  const stamps = [entry.createdAt, entry.modifiedAt, entry.openedAt]
    .filter((value): value is number => typeof value === 'number')
  return stamps.length === 0 ? -Infinity : Math.max(...stamps)
}

/**
 * The library with the coldest entries beyond MAX_MAPS dropped, plus the ids
 * that went. Never a `kept` id: the entry just written, and the maps the
 * caller is about to write to, since dropping one of those would only have
 * its next save add it back as a 51st. Ties keep the earlier row, so a run of
 * unstamped legacy entries goes oldest-first.
 */
function evictBeyondCap(maps: unknown[], kept: ReadonlySet<string>): { maps: unknown[]; evicted: string[] } {
  const excess = maps.length - MAX_MAPS
  if (excess <= 0) return { maps, evicted: [] }
  const cold = maps
    .map((entry, index) => ({ index, id: mapEntryId(entry), touched: lastTouched(entry) }))
    .filter(({ id }) => id === null || !kept.has(id))
    .sort((left, right) => left.touched - right.touched)
    .slice(0, excess)
  const dropped = new Set(cold.map(({ index }) => index))
  const evicted = cold.map(({ id }) => id).filter((id): id is string => id !== null)
  return { maps: maps.filter((_, index) => !dropped.has(index)), evicted }
}

/** A new map beyond MAX_MAPS evicts the least recently touched entries. */
export function saveMap(name: string, game: Game, keep: ReadonlySet<string> = new Set()): SaveMapResult {
  if (name.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const maps = readRawMaps().entries
  if (maps.some((entry) => isNamedMapEntry(entry) && entry.name === name)) {
    return { ok: false, error: 'A map with this name already exists' }
  }
  const entry = mapEntry(name, game, null)
  const capped = evictBeyondCap([...maps, entry], new Set([...keep, entry.id]))
  const result = writeMaps(capped.maps)
  if (!result.ok) return result
  return { ok: true, id: entry.id, ...(capped.evicted.length > 0 ? { evicted: capped.evicted } : {}) }
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

// Parsed games, keyed by the exact blob they came from. The autosave compares
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
      cache.set(id, parseGame((entry as Record<string, unknown>).game))
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
  if (raw === null) return { ok: false }

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
    const parsed = parseGame(entry.game)
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
  const workspace: PersistedWorkspace = { tabs }
  return invalidTabs.length > 0
    ? { ok: true, workspace, warning: `Ignored invalid workspace tabs: ${invalidTabs.join(', ')}` }
    : { ok: true, workspace }
}
