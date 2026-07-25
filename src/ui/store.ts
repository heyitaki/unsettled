import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react'
import { createBoard } from '../model/board'
import { newGame, withBoard, type Game } from '../model/game'
import { newId } from '../model/ids'
import type {
  Board,
  BuildingTier,
  Resource,
  TileKind,
} from '../model/types'
import {
  MAPS_KEY,
  WORKSPACE_KEY,
  loadMaps,
  loadWorkspace,
  migrateMapIds,
  readLibrary,
  readWorkspaceBlob,
  saveWorkspace,
  storedTabLinks,
  workspaceBlob,
  type LibraryView,
  type PersistedWorkspace,
  type WorkspaceTab,
} from '../persistence/localStorage'
import { savedMap, tabIsDirty } from './boardFiles'

export type Tool =
  | { kind: 'none' }
  | { kind: 'tile'; tile: TileKind }
  | { kind: 'token'; number: number }
  | { kind: 'port'; resource: Resource | null; rate: number }
  | { kind: 'robber' }
  | { kind: 'erase' }
  | { kind: 'piece'; tier: 'road' | BuildingTier }

/**
 * A board mark surfaced from analysis: a highlighted ref (vertex/hex/port id)
 * optionally tinted to a player's colour and stamped with a short label (a pick
 * number). Drives the coloured, numbered circles the AnalysisPanel draws.
 */
export interface HighlightMark {
  ref: string
  color?: string
  label?: string
}

export interface TabState {
  id: string
  title: string
  game: Game
  past: Game[]
  future: Game[]
  /**
   * Whose pieces board edits place, or null when nobody is selected: clicking
   * the selected player's dot deselects, which parks the piece tools the same
   * way clicking the selected tool does.
   */
  activePlayerId: string | null
  /**
   * The library map this tab is a view of, by map id, or null for a tab that
   * was never saved to or opened from the library. The link is an id and never
   * the title: titles collide, get renamed, and are regenerated for fresh tabs,
   * which is how blank boards used to impersonate saved maps.
   */
  mapId: string | null
}

export interface StoreState {
  tabs: TabState[]
  activeTabId: string
  tool: Tool
  notice: string | null
  // Bumped on every 'notice' dispatch so the auto-dismiss timer restarts even
  // when the same message text is shown twice in a row.
  noticeSeq: number
  highlight: readonly HighlightMark[] | null
  // Bumped whenever the library changes, here or in another document. The maps
  // blob lives outside React, so panels that read it re-render off this.
  mapsRevision: number
}

export type StoreAction =
  // Board edits dispatch the next Board; the reducer wraps it into the tab's
  // game (reconciling stats with any roster change). Stat edits dispatch the
  // whole next Game via commit-game. Both share one undo stack of games.
  | { type: 'commit'; board: Board }
  | { type: 'commit-game'; game: Game }
  | { type: 'tool'; tool: Tool }
  | { type: 'active-player'; playerId: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'notice'; message: string | null }
  | { type: 'highlight'; marks: readonly HighlightMark[] | null }
  | { type: 'tab-add'; game?: Game; title?: string; id?: string; mapId?: string }
  | { type: 'tab-select'; id: string }
  | { type: 'tab-rename'; id: string; title: string }
  | { type: 'tab-close'; id: string }
  // Attaches a tab to the library map it was just saved into or opened from.
  | { type: 'tab-link'; id: string; mapId: string; title: string }
  // The library changed (here or in another document); see LibraryView.
  | { type: 'maps-changed'; library: LibraryView }
  // Replaces the tab set with what another document persisted, except where
  // this document holds work that write could not have known about; see
  // UnflushedWork.
  | {
    type: 'workspace-adopt'
    tabs: WorkspaceTab[]
    unflushed?: UnflushedWork
    warning?: string
  }

/**
 * What this document holds that shared storage has not been told about: tabs it
 * opened, links it made, and tabs it closed since its last write. An incoming
 * blob was serialized before any of it happened, so it has no opinion on it and
 * an adoption has to defer to all three.
 */
export interface UnflushedWork {
  /** Opened here and never written: survives an adoption that omits it. */
  added: readonly string[]
  /** Relinked here and not written: outranks the link the blob carries. */
  relinked: readonly string[]
  /** Closed here and not written: the blob still lists it; ignore it. */
  closed: readonly string[]
}

export const NOTHING_UNFLUSHED: UnflushedWork = { added: [], relinked: [], closed: [] }

/**
 * Settle every tab's link against the library: drop links whose map is gone
 * (the tab keeps its content, as unsaved work), and retitle a linked tab to its
 * map's current name. A linked tab's title mirrors its map — renaming either
 * renames both — so a rename in another document has to land here, or this
 * document would keep saving under a stale name and fork the map in two.
 */
function reconcileLinks(tabs: TabState[], library: LibraryView): TabState[] {
  if (!library.readable) return tabs
  const nameById = new Map(library.maps.map((map) => [map.id, map.name]))
  return tabs.map((tab) => {
    if (tab.mapId === null) return tab
    const name = nameById.get(tab.mapId)
    if (name === undefined) return { ...tab, mapId: null }
    return name === tab.title ? tab : { ...tab, title: name }
  })
}

/**
 * One map is the view of at most one tab. Two tabs holding the same link would
 * each treat a save as "overwrite my own map" and silently destroy the other's
 * work, so the first tab keeps the link and any later claimant is unlinked —
 * it keeps its board, as unsaved work.
 */
function withOneTabPerMap(tabs: TabState[]): TabState[] {
  const linked = new Set<string>()
  return tabs.map((tab) => {
    if (tab.mapId === null) return tab
    if (linked.has(tab.mapId)) return { ...tab, mapId: null }
    linked.add(tab.mapId)
    return tab
  })
}

function createTab({ game, title, id, activePlayerId, mapId }: Partial<WorkspaceTab> = {}): TabState {
  const resolved = game ?? newGame(createBoard('standard4'))
  return {
    id: id ?? newId(),
    title: title ?? 'Board 1',
    game: resolved,
    past: [],
    future: [],
    activePlayerId: activePlayerFor(resolved.board, activePlayerId),
    mapId: mapId ?? null,
  }
}

/**
 * Before map ids existed, a tab claimed a library map by title alone. Restore
 * those links once, but only where the tab's game is byte-identical to the
 * saved map: a same-named tab holding anything else was never that map's view,
 * and guessing otherwise is the exact ambiguity ids were introduced to end.
 * One map claims at most one tab, so a duplicate title cannot link twice.
 */
export function adoptLegacyLinks(tabs: TabState[], library: LibraryView): TabState[] {
  if (!library.readable || tabs.every((tab) => tab.mapId !== null)) return tabs
  const idByName = new Map<string, string>()
  for (const map of library.maps) {
    if (!idByName.has(map.name)) idByName.set(map.name, map.id)
  }
  const candidates = tabs
    .map((tab) => (tab.mapId === null ? idByName.get(tab.title) : undefined))
    .filter((id): id is string => id !== undefined)
  if (candidates.length === 0) return tabs
  const saved = loadMaps(candidates)
  const claimed = new Set(tabs.map((tab) => tab.mapId))
  return tabs.map((tab) => {
    if (tab.mapId !== null) return tab
    const mapId = idByName.get(tab.title)
    if (mapId === undefined || claimed.has(mapId)) return tab
    // Identical to what the library holds, by the same comparison the tab strip
    // uses — so this cannot drift from what "matches its saved map" means.
    if (tabIsDirty(tab.game, savedMap(saved.get(mapId)))) return tab
    claimed.add(mapId)
    return { ...tab, mapId }
  })
}

function initialState(): StoreState {
  // Stamp ids on maps saved before ids existed, so they are linkable from the
  // first interaction rather than only after their next write. A failure here
  // leaves the whole legacy library unaddressable, so it has to be said out
  // loud rather than discovered as "this map is malformed" on every row.
  const migration = migrateMapIds()
  const restored = loadWorkspace()
  const library = readLibrary()
  // Links are reconciled at startup too, not only on the storage event: a map
  // deleted while this document was closed would otherwise leave every tab
  // pointing at nothing, which reads as "everything is unsaved".
  // withOneTabPerMap last: a stored workspace can hold two tabs on one map —
  // hand-edited, or written before the invariant existed — and every path that
  // creates a link enforces it, so loading one must too.
  const tabs = restored.ok
    ? withOneTabPerMap(
      reconcileLinks(adoptLegacyLinks(restored.workspace.tabs.map(createTab), library), library),
    )
    : [createTab()]
  return {
    tabs,
    activeTabId: restored.ok ? restored.workspace.activeTabId : tabs[0].id,
    tool: { kind: 'tile', tile: 'wood' },
    notice: migration.ok
      ? restored.ok ? restored.warning ?? null : null
      : `Could not upgrade the map library: ${migration.error}`,
    noticeSeq: 0,
    highlight: null,
    mapsRevision: 0,
  }
}

export function activeTab(state: StoreState): TabState {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  if (!tab) throw new Error('Active workspace tab was not found')
  return tab
}

// null is a deliberate deselect and survives reconciliation; undefined or a
// dangling id (a removed player, an undone roster) falls back to the first.
function activePlayerFor(board: Board, activePlayerId?: string | null): string | null {
  if (activePlayerId === null) return null
  return activePlayerId !== undefined &&
    board.players.some((player) => player.id === activePlayerId)
    ? activePlayerId
    : board.players[0].id
}

function updateActiveTab(
  state: StoreState,
  update: (tab: TabState) => TabState,
): StoreState {
  const current = activeTab(state)
  const next = update(current)
  if (next === current) return state
  const tabs = [...state.tabs]
  tabs[state.tabs.indexOf(current)] = next
  return { ...state, tabs }
}

function unusedBoardTitle(tabs: TabState[]): string {
  const titles = new Set(tabs.map((tab) => tab.title))
  let index = 1
  while (titles.has(`Board ${index}`)) index += 1
  return `Board ${index}`
}

export function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'commit':
      return updateActiveTab(state, (tab) => {
        const game = withBoard(tab.game, action.board)
        if (game === tab.game) return tab
        return {
          ...tab,
          game,
          activePlayerId: activePlayerFor(game.board, tab.activePlayerId),
          past: [...tab.past, tab.game].slice(-50),
          future: [],
        }
      })
    case 'commit-game':
      return updateActiveTab(state, (tab) => {
        if (action.game === tab.game) return tab
        return {
          ...tab,
          game: action.game,
          past: [...tab.past, tab.game].slice(-50),
          future: [],
        }
      })
    case 'tool':
      return { ...state, tool: action.tool }
    case 'active-player':
      // Reconciled like every other write to activePlayerId: a dangling id would
      // reach placeRoad/placeBuilding, which reject it by throwing.
      return updateActiveTab(state, (tab) => ({
        ...tab,
        activePlayerId: activePlayerFor(tab.game.board, action.playerId),
      }))
    case 'undo':
      return updateActiveTab(state, (tab) => {
        const game = tab.past.at(-1)
        if (!game) return tab
        return {
          ...tab,
          game,
          activePlayerId: activePlayerFor(game.board, tab.activePlayerId),
          past: tab.past.slice(0, -1),
          future: [tab.game, ...tab.future].slice(0, 50),
        }
      })
    case 'redo':
      return updateActiveTab(state, (tab) => {
        const game = tab.future[0]
        if (!game) return tab
        return {
          ...tab,
          game,
          activePlayerId: activePlayerFor(game.board, tab.activePlayerId),
          past: [...tab.past, tab.game].slice(-50),
          future: tab.future.slice(1),
        }
      })
    case 'notice':
      return { ...state, notice: action.message, noticeSeq: state.noticeSeq + 1 }
    case 'highlight':
      return { ...state, highlight: action.marks }
    case 'tab-add': {
      const tab = createTab({
        game: action.game,
        title: action.title ?? unusedBoardTitle(state.tabs),
        id: action.id,
        mapId: action.mapId,
      })
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      }
    }
    case 'tab-select':
      if (!state.tabs.some((tab) => tab.id === action.id)) return state
      return action.id === state.activeTabId ? state : { ...state, activeTabId: action.id }
    case 'tab-rename': {
      if (action.title.trim().length === 0) return state
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      if (index < 0) return state
      const tabs = [...state.tabs]
      tabs[index] = { ...tabs[index], title: action.title }
      return { ...state, tabs }
    }
    case 'tab-link': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      if (index < 0) return state
      const tabs = state.tabs.map((tab, tabIndex) => {
        if (tabIndex === index) return { ...tab, mapId: action.mapId, title: action.title }
        // One map is the view of at most one tab. Two tabs holding the same
        // link would each treat a save as "overwrite my own map" and silently
        // destroy the other's saved work.
        return tab.mapId === action.mapId ? { ...tab, mapId: null } : tab
      })
      return { ...state, tabs, mapsRevision: state.mapsRevision + 1 }
    }
    case 'maps-changed': {
      const tabs = reconcileLinks(state.tabs, action.library)
      const changed = tabs.some((tab, index) => tab !== state.tabs[index])
      return {
        ...state,
        ...(changed ? { tabs } : {}),
        mapsRevision: state.mapsRevision + 1,
      }
    }
    case 'tab-close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      if (index < 0) return state
      const tabs = state.tabs.filter((_, tabIndex) => tabIndex !== index)
      if (tabs.length === 0) {
        const tab = createTab()
        return { ...state, tabs: [tab], activeTabId: tab.id }
      }
      if (action.id !== state.activeTabId) return { ...state, tabs }
      return {
        ...state,
        tabs,
        activeTabId: (tabs[index] ?? tabs.at(-1)).id,
      }
    }
    case 'workspace-adopt': {
      // Every open document shares one workspace key, so an incoming write is
      // authoritative about which tabs exist — merging additively would let a
      // stale window resurrect tabs this one just closed. Tabs listed in both
      // keep their local TabState (undo stacks, active player). The one thing
      // the blob cannot speak for is work written after it was serialized,
      // which is what `unflushed` carries.
      const { added, relinked, closed } = action.unflushed ?? NOTHING_UNFLUSHED
      const local = new Map(state.tabs.map((tab) => [tab.id, tab]))
      const openedHere = new Set(added)
      const relinkedHere = new Set(relinked)
      const closedHere = new Set(closed)
      const tabs: TabState[] = []
      const adoptedIds = new Set<string>()
      for (const incoming of action.tabs) {
        // Closed here, and in the blob only because the blob predates the
        // close. Adopting it would put the tab back on screen and our own
        // pending write would then persist it — the resurrection users hit when
        // they close several tabs with a second window open, each close racing
        // that window's echo of the workspace as it was a moment ago.
        if (closedHere.has(incoming.id)) continue
        if (adoptedIds.has(incoming.id)) continue
        adoptedIds.add(incoming.id)
        const existing = local.get(incoming.id)
        if (existing === undefined) {
          tabs.push(createTab(incoming))
          continue
        }
        // Local content and undo stacks win — they cannot be merged — but the
        // link is the incoming blob's to state, because otherwise the two
        // documents disagree about it forever, each autosave overwriting the
        // other's. The exception is a link made here and not yet written: that
        // is newer than anything the blob can hold.
        const mapId = relinkedHere.has(incoming.id)
          ? existing.mapId
          : incoming.mapId ?? null
        tabs.push(mapId === existing.mapId ? existing : { ...existing, mapId })
      }
      for (const tab of state.tabs) {
        if (!adoptedIds.has(tab.id) && openedHere.has(tab.id)) tabs.push(tab)
      }
      if (tabs.length === 0) return state
      // A kept local tab can hold the same link as an adopted one, because both
      // windows opened the map. Incoming tabs come first, so the persisted link
      // wins and the unflushed duplicate is the one dropped.
      const settled = withOneTabPerMap(tabs)
      // An echo of our own list must return the same state object, or the two
      // documents write back and forth forever. Compared by reference, so an
      // adopted link still counts as a change.
      const unchanged = settled.length === state.tabs.length &&
        settled.every((tab, index) => tab === state.tabs[index])
      if (unchanged) return state
      return {
        ...state,
        tabs: settled,
        activeTabId: settled.some((tab) => tab.id === state.activeTabId)
          ? state.activeTabId
          : settled[0].id,
        // Tabs that failed to parse were dropped from the incoming set; say so
        // here rather than on every echo of a blob that still contains them.
        ...(action.warning === undefined
          ? {}
          : { notice: action.warning, noticeSeq: state.noticeSeq + 1 }),
      }
    }
  }
}

/**
 * What another document's storage write means for this one. Pure apart from
 * re-reading localStorage, so the cross-document paths are testable without a
 * DOM harness.
 *
 * `unflushed` is what this document has not written yet, and is the only thing
 * an adoption defers to. Anything else it holds is the other document's to
 * close or relink: a tab this one *has* persisted and the blob omits was closed
 * on purpose there, and re-adding it would write it straight back.
 */
export function storageActions(
  event: Pick<StorageEvent, 'key' | 'newValue'>,
  unflushed: UnflushedWork = NOTHING_UNFLUSHED,
): StoreAction[] {
  // A null key is localStorage.clear() in another document: everything changed.
  const cleared = event.key === null
  const library = cleared || event.key === MAPS_KEY ? readLibrary() : null
  const actions: StoreAction[] = []
  if (!cleared && (event.key !== WORKSPACE_KEY || event.newValue === null)) {
    if (library !== null) actions.push({ type: 'maps-changed', library })
    return actions
  }
  const restored = loadWorkspace()
  // A workspace that no longer parses leaves this document's tabs alone; they
  // are the last good copy, not something to reconcile away.
  if (restored.ok) {
    actions.push({
      type: 'workspace-adopt',
      tabs: restored.workspace.tabs,
      unflushed,
      ...(restored.warning === undefined ? {} : { warning: restored.warning }),
    })
  }
  // Reconcile after adopting, never before: a link that arrives with an adopted
  // tab still needs its title settled against the library.
  if (library !== null) actions.push({ type: 'maps-changed', library })
  return actions
}

/**
 * This document's divergence from shared storage, as the difference between
 * what it last wrote or adopted (`persisted`: tab id → linked map id) and the
 * workspace waiting on the autosave debounce. `pending` is null when no write
 * is in flight, and then nothing is unflushed by definition — a document with
 * an empty outbox must not read its whole tab list as freshly closed.
 */
export function unflushedWork(
  persisted: ReadonlyMap<string, string | null>,
  pending: readonly WorkspaceTab[] | null,
): UnflushedWork {
  if (pending === null) return NOTHING_UNFLUSHED
  const added: string[] = []
  const relinked: string[] = []
  for (const tab of pending) {
    if (!persisted.has(tab.id)) added.push(tab.id)
    else if (persisted.get(tab.id) !== (tab.mapId ?? null)) relinked.push(tab.id)
  }
  const open = new Set(pending.map((tab) => tab.id))
  const closed = [...persisted.keys()].filter((id) => !open.has(id))
  return { added, relinked, closed }
}

/**
 * The same map after adopting another document's workspace: a mirror of the
 * blob just read, which is exactly what shared storage is known to hold. Ids the
 * blob drops fall out of it, and ids it carries stay — including a tab closed
 * here whose write is still in flight, so a second event for the same blob
 * still recognises the close rather than resurrecting the tab.
 */
export function withAdopted(
  persisted: ReadonlyMap<string, string | null>,
  tabs: readonly WorkspaceTab[],
  unflushed: UnflushedWork,
): Map<string, string | null> {
  const relinked = new Set(unflushed.relinked)
  const next = new Map<string, string | null>()
  for (const tab of tabs) {
    // A link made here and not yet written stays unflushed: the adoption
    // refused the incoming one, so the difference is still ours to save.
    next.set(tab.id, relinked.has(tab.id) ? persisted.get(tab.id) ?? null : tab.mapId ?? null)
  }
  return next
}

/**
 * What a pending autosave should do about the blob storage currently holds.
 * `seen` is the blob this document last wrote or read.
 *
 * A document may only overwrite a blob it has seen. Anything else means another
 * one wrote while this was not listening — a window restored from bfcache is the
 * ordinary case — and overwriting would erase that work and resurrect whatever
 * it closed. Rewriting a blob byte-for-byte is skipped outright: it changes
 * nothing here and fires a storage event in every other document, and that echo,
 * landing inside another window's debounce, is what races its unflushed closes.
 */
export function writeVerdict(
  pending: string,
  stored: string | null,
  seen: string | null,
): 'write' | 'skip' | 'resync' {
  if (stored !== seen) return 'resync'
  return stored === pending ? 'skip' : 'write'
}

/**
 * The persisted shape of a workspace: everything about the tabs that outlives a
 * reload. Takes the two fields it reads rather than the whole store state, so
 * that an autosave is armed by a tab change and not by a notice or a highlight.
 */
export function persistedWorkspace(
  tabs: readonly TabState[],
  activeTabId: string,
): PersistedWorkspace {
  return {
    activeTabId,
    tabs: tabs.map(({ id, title, game, activePlayerId, mapId }) => ({
      id,
      title,
      game,
      // The persisted shape has no null: a deselect is session-only, and a
      // reloaded workspace comes back with the first player selected.
      ...(activePlayerId === null ? {} : { activePlayerId }),
      ...(mapId === null ? {} : { mapId }),
    })),
  }
}

export type FlushOutcome =
  // Written, or already exactly what storage held: either way, settled.
  | 'settled'
  // Stood down and adopted instead; the workspace is still owed a write.
  | 'resynced'

/**
 * This document's side of the shared workspace key: what it has written, what
 * it last saw there, and what it still owes. Deliberately outside React, so
 * that two of these can be driven against one localStorage in a test — the
 * races between documents are not observable any other way, and every bug this
 * protocol has had has been a race.
 */
export function createWorkspaceSync(dispatch: (action: StoreAction) => void) {
  // Seeded from the stored blob rather than from the initial tabs, because
  // startup reconciliation can already have changed links nothing has written,
  // and a tab invented because no workspace was stored is unflushed work.
  //
  // Tab id → linked map id, as this document has written or adopted them: what
  // it is showing and this does not hold is unflushed work, and what this holds
  // and an incoming blob does not was closed on purpose elsewhere.
  let persistedTabs = storedTabLinks()
  // The workspace blob this document last wrote or read; see writeVerdict.
  let seen = readWorkspaceBlob()
  let pending: PersistedWorkspace | null = null

  const receive = (event: Pick<StorageEvent, 'key' | 'newValue'>) => {
    const flushed = persistedTabs
    const unflushed = unflushedWork(flushed, pending?.tabs ?? null)
    // Reading the blob is what makes it seen, whether or not it yields an
    // adoption: one that no longer parses produces no actions and must still be
    // overwritable, or this document could never write again.
    if (event.key === null || event.key === WORKSPACE_KEY) seen = readWorkspaceBlob()
    for (const action of storageActions(event, unflushed)) {
      if (action.type === 'workspace-adopt') {
        persistedTabs = withAdopted(flushed, action.tabs, unflushed)
      }
      dispatch(action)
    }
  }

  return {
    /** The workspace this document now owes storage, replacing any earlier one. */
    arm(workspace: PersistedWorkspace) {
      pending = workspace
    },
    receive,
    /**
     * Writes what is owed. `only` holds the write to that workspace, so a
     * debounce a newer edit has already superseded does nothing.
     */
    flush(only?: PersistedWorkspace): FlushOutcome {
      const workspace = pending
      if (workspace === null || (only !== undefined && only !== workspace)) return 'settled'
      const blob = workspaceBlob(workspace)
      const stored = readWorkspaceBlob()
      const verdict = writeVerdict(blob, stored, seen)
      if (verdict === 'resync') {
        // Dropped, not held: what was owed described the tabs as they stood
        // before the adoption, and writing that afterwards would undo it. The
        // caller re-arms from the reconciled state instead.
        pending = null
        receive({ key: WORKSPACE_KEY, newValue: stored })
        return 'resynced'
      }
      if (verdict === 'write') {
        const result = saveWorkspace(workspace)
        if (!result.ok) {
          // Not owed a retry: the same write would fail the same way, and the
          // state is still here to be saved on the user's next edit.
          pending = null
          dispatch({ type: 'notice', message: `Autosave failed: ${result.error}` })
          return 'settled'
        }
      }
      // Storage now holds exactly this, whether this document wrote it or found
      // it already there.
      pending = null
      seen = blob
      persistedTabs = new Map(workspace.tabs.map((tab) => [tab.id, tab.mapId ?? null]))
      return 'settled'
    },
  }
}

const StoreContext = createContext<{ state: StoreState; dispatch: Dispatch<StoreAction> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  // Created on the first render, when its reads of shared storage are still
  // this document's own history rather than another document's write.
  const [sync] = useState(() => createWorkspaceSync(dispatch))
  // Bumped when a write stood down to adopt a blob this document had not seen,
  // to re-arm the autosave so the reconciled workspace is written in its place.
  const [resyncs, setResyncs] = useState(0)
  useEffect(() => {
    const workspace = persistedWorkspace(state.tabs, state.activeTabId)
    sync.arm(workspace)
    const timeout = window.setTimeout(() => {
      // A resync drops what was owed in favour of what it adopted; re-running
      // this effect is what arms the reconciled workspace in its place.
      if (sync.flush(workspace) === 'resynced') setResyncs((count) => count + 1)
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [sync, state.tabs, state.activeTabId, resyncs])
  useEffect(() => {
    window.addEventListener('storage', sync.receive)
    return () => window.removeEventListener('storage', sync.receive)
  }, [sync])
  useEffect(() => {
    // A write that stands down here is not retried: the page is going away, and
    // overwriting a blob this document never saw would resurrect, in the window
    // that is staying, whatever it just closed.
    const flushWorkspace = () => void sync.flush()
    window.addEventListener('pagehide', flushWorkspace)
    return () => window.removeEventListener('pagehide', flushWorkspace)
  }, [sync])
  const value = useMemo(() => ({ state, dispatch }), [state])
  return createElement(StoreContext.Provider, { value }, children)
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
