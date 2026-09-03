import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
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
  loadActiveTab,
  loadMaps,
  loadWorkspace,
  migrateMapIds,
  readLibrary,
  saveActiveTab,
  type LibraryView,
  type WorkspaceTab,
} from '../persistence/localStorage'
import { savedMap, tabIsDirty } from './boardFiles'
import { createLibraryAutosave } from './libraryAutosave'
import {
  NOTHING_UNFLUSHED,
  createWorkspaceSync,
  persistedWorkspace,
  type UnflushedWork,
} from './workspaceSync'

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
 * number). Drives the coloured, numbered circles the AnalysisPanel draws. A
 * faded mark is a pick that sits back from the others: a planned follow-up, or
 * a lower rank shown alongside the top three.
 *
 * `kind: 'road'` names a direction rather than a place, and it exists because a
 * road and a port are both keyed by the edge they sit on: without it the canvas
 * cannot tell a recommended road from a port an import issue is pointing at, and
 * would draw a road stub over the port and light the port up under the road.
 */
export interface HighlightMark {
  ref: string
  color?: string
  label?: string
  faded?: boolean
  kind?: 'road'
}

export interface TabState {
  id: string
  title: string
  game: Game
  past: Game[]
  future: Game[]
  /**
   * Whose pieces board edits place, or null when nobody is selected: clicking
   * the selected player's swatch deselects, which parks the piece tools the
   * same way clicking the selected tool does.
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
    // Identical to what the library holds, by the same comparison the autosave
    // uses — so this cannot drift from what "matches its saved map" means.
    if (tabIsDirty(tab.game, savedMap(saved.get(mapId)))) return tab
    claimed.add(mapId)
    return { ...tab, mapId }
  })
}

/**
 * Which board this window opens on: the one it was looking at before the
 * reload, else whatever the last window to write the old shared field was
 * looking at, else the first tab. A window opened fresh has no session of its
 * own and so starts at the front of the open-boards list rather than
 * inheriting another window's place.
 */
export function bootActiveTab(tabs: readonly TabState[], legacy: string | undefined): string {
  const resolves = (id: string | null | undefined): id is string =>
    id !== null && id !== undefined && tabs.some((tab) => tab.id === id)
  const session = loadActiveTab()
  if (resolves(session)) return session
  return resolves(legacy) ? legacy : tabs[0].id
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
    activeTabId: bootActiveTab(tabs, restored.ok ? restored.workspace.activeTabId : undefined),
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
          // A whole game can carry a different roster (build mode's Cancel
          // restores one), so the id is reconciled as every other write is.
          activePlayerId: activePlayerFor(action.game.board, tab.activePlayerId),
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
      // Marks are rebuilt per hover, so only the identical value (null to null,
      // most of all) is a no-op; sweeping the draft ribbon clears an already
      // empty highlight once per slot, and each of those would otherwise
      // re-render every consumer of the store.
      return action.marks === state.highlight ? state : { ...state, highlight: action.marks }
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

const StoreContext = createContext<{ state: StoreState; dispatch: Dispatch<StoreAction> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  // Created on the first render, when their reads of shared storage are still
  // this document's own history rather than another document's write.
  const [{ autosave, sync }] = useState(() => ({
    autosave: createLibraryAutosave(dispatch, state.tabs),
    sync: createWorkspaceSync(dispatch),
  }))
  // A write that stood down leaves work owed, and the reconciled workspace only
  // exists after a render — so the retry is a render this asks for. Nothing
  // reads the token; it is the dependency that re-runs the arming effect.
  const [rearmToken, rearm] = useReducer((token: number) => token + 1, 0)
  // Whether the arming below is a retry, which the delay it picks depends on.
  const deferred = useRef(false)
  // Layout, not passive: a storage event delivered between this commit and the
  // arming would have `receive` diff an incoming blob against the tab set as it
  // was *before* the edit, so a tab closed a moment ago reads as still open and
  // the adoption puts it back. Layout effects run in the same task as the
  // commit, so nothing can be delivered in between.
  useLayoutEffect(() => {
    const workspace = persistedWorkspace(state.tabs)
    sync.arm(workspace)
    // A deferred write has already reconciled and holds a fresh read of storage,
    // so it retries promptly rather than serving another full debounce — which
    // is also what stops a document from starving behind a busier one.
    const timeout = window.setTimeout(
      () => {
        if (sync.flush(workspace) !== 'deferred') return
        deferred.current = true
        rearm()
      },
      deferred.current ? 50 : 500,
    )
    deferred.current = false
    return () => window.clearTimeout(timeout)
  }, [sync, state.tabs, deferred, rearmToken])
  // Per-window, so it never touches the shared blob and never wakes another
  // document; written straight out rather than debounced because it is one
  // short string and losing it costs the user their place.
  useEffect(() => saveActiveTab(state.activeTabId), [state.activeTabId])
  // Layout as well: the unload flush below drains whatever the autosave last
  // saw, and a page hidden between this commit and a passive effect would flush
  // a set without the edit. The workspace still keeps it, but a reload
  // baselines the tab as already saved, so an unlinked board never reaches the
  // library and closing it loses the only copy.
  useLayoutEffect(() => autosave.arm(state.tabs), [autosave, state.tabs])
  // Layout, for the same reason as the arming above and because this effect is
  // declared after it: a write landing between the first commit and a passive
  // listener would never be delivered at all, leaving `seen` stale from birth.
  useLayoutEffect(() => {
    window.addEventListener('storage', sync.receive)
    return () => window.removeEventListener('storage', sync.receive)
  }, [sync])
  useEffect(() => {
    // Hiding is the last moment a write can be retried with the page still
    // alive, so flush there rather than waiting for pagehide — by then a
    // document whose storage moved underneath it can only stand down, and
    // whatever it still owed is lost.
    const flushWorkspace = () => {
      // A link the autosave makes here rides a dispatch that will not render
      // before the document unloads, so the workspace is re-armed with it
      // rather than written as it stood before the save.
      const linked = autosave.flush()
      if (linked !== null) sync.arm(persistedWorkspace(linked))
      void sync.flush()
    }
    // A document restored from bfcache missed every write while it was frozen.
    // Reading storage back is what stops its stale view from being written out.
    const resyncRestored = (event: PageTransitionEvent) => {
      if (event.persisted) sync.resync()
    }
    const flushHidden = () => {
      if (document.visibilityState === 'hidden') flushWorkspace()
    }
    window.addEventListener('pagehide', flushWorkspace)
    window.addEventListener('pageshow', resyncRestored)
    document.addEventListener('visibilitychange', flushHidden)
    return () => {
      window.removeEventListener('pagehide', flushWorkspace)
      window.removeEventListener('pageshow', resyncRestored)
      document.removeEventListener('visibilitychange', flushHidden)
      autosave.dispose()
    }
  }, [sync, autosave])
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch])
  return createElement(StoreContext.Provider, { value }, children)
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
