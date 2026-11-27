import {
  createContext,
  createElement,
  useCallback,
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
import { isEmptyCorrection, newGame, withBoard, type Game } from '../model/game'
import { newId } from '../model/ids'
import { initializeAwards, trackAwards } from '../engine/stats'
import { closeCorrection } from '../model/turn'
import { inferDraftState } from '../engine/draft'
import { gameStarted } from '../engine/gameStage'
import type {
  Board,
  EdgeId,
  TileKind,
} from '../model/types'
import {
  ANALYSIS_CACHE_KEY,
  loadActiveTab,
  loadMaps,
  loadWorkspace,
  readLibrary,
  saveActiveTab,
  type LibraryView,
  type WorkspaceTab,
} from '../persistence/localStorage'
import { savedMap, tabIsDirty } from './boardFiles'
import { openImportQuestions } from './importQuestions'
import { AUTOSAVE_DELAY, createLibraryAutosave } from './libraryAutosave'
import type { ReportSave, SaveFailure } from './saveStatus'
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
  // Build mode with no tool button selected: taps act on the nearest target.
  | { kind: 'piece' }

/**
 * A board mark surfaced from analysis: a highlighted ref (vertex/hex/port id)
 * optionally tinted to a player's colour and stamped with a short label (a pick
 * number). Drives the coloured, numbered circles the AnalysisPanel draws. A
 * faded vertex mark sits back from the others: a planned follow-up pick.
 * Every road mark is a faded full road.
 * A `placeable` mark is a Best picks first pick, the one mark a draft tap
 * places on while the tools are closed.
 *
 * `kind: 'road'` names a direction rather than a place, and it exists because a
 * road and a port are both keyed by the edge they sit on: without it the canvas
 * cannot tell a recommended road from a port an import issue is pointing at, and
 * would draw a faded road over the port and light the port up under the road.
 */
export interface HighlightMark {
  ref: string
  color?: string
  label?: string
  faded?: boolean
  placeable?: boolean
  kind?: 'road' | 'hex'
}

export type PickTarget =
  | { want: 'vertex'; piece: 'settlement' | 'city' }
  | { want: 'edge'; edges?: readonly EdgeId[] }
  | { want: 'hex' }
// MOCK (special build phase): whose slots a vertex or edge pick offers, when not the turn's player.
export type PlayerPick = PickTarget & { playerId?: string }
export type BoardPick = PlayerPick & { ref?: string }

export interface TabState {
  id: string
  title: string
  game: Game
  past: Game[]
  future: Game[]
  /**
   * Whose pieces board edits place, or null when nobody is selected: clicking
   * the selected player's swatch deselects, which parks the piece tools.
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
  pick?: BoardPick | null
  viewedPick?: number | null
  viewedPlayer?: string | null
  historyOpen?: boolean
  viewedTurn?: number | null
  // Bumped whenever the library changes, here or in another document. The maps
  // blob lives outside React, so panels that read it re-render off this.
  mapsRevision: number
}

export type StoreAction =
  // Board edits dispatch the next Board; the reducer wraps it into the tab's
  // game (reconciling stats with any roster change). Stat edits dispatch the
  // whole next Game via commit-game. Both share one undo stack of games.
  | { type: 'commit'; board: Board }
  // `correction` marks a ledger correction, which keeps an open correction run open.
  | { type: 'commit-game'; game: Game; correction?: boolean }
  | { type: 'tool'; tool: Tool }
  | { type: 'active-player'; playerId: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'notice'; message: string | null }
  | { type: 'highlight'; marks: readonly HighlightMark[] | null }
  | { type: 'pick'; target: PlayerPick }
  | { type: 'pick-clear' }
  | { type: 'picked'; ref: string }
  | { type: 'view-pick'; slot: number | null }
  | { type: 'view-player'; playerId: string | null }
  | { type: 'history'; open: boolean }
  | { type: 'view-turn'; index: number | null }
  | { type: 'tab-add'; game?: Game; title?: string; id?: string; mapId?: string }
  | { type: 'tab-select'; id: string }
  | { type: 'tab-rename'; id: string; title: string }
  // `discard`: the tab's map was deleted with it, so the autosave must not
  // rescue the tab's last edit into a new map on the way out.
  | { type: 'tab-close'; id: string; discard?: boolean }
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
  const resolved = initializeAwards(game ?? newGame(createBoard('standard4')))
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

export function bootActiveTab(tabs: readonly TabState[]): string {
  const session = loadActiveTab()
  return session !== null && tabs.some((tab) => tab.id === session) ? session : tabs[0].id
}

function initialState(): StoreState {
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
    activeTabId: bootActiveTab(tabs),
    tool: { kind: 'none' },
    notice: restored.ok ? restored.warning ?? null : null,
    noticeSeq: 0,
    highlight: null,
    pick: null,
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

// Ledger corrections undo one tap at a time while their run is open. Any other commit closes the
// run, which then undoes as one step, or drops out of the stack when its taps cancel out.
function closeCorrectionRun(tab: TabState): Game[] {
  const run = tab.game.turn?.correction
  if (!run) return [...tab.past, tab.game].slice(-50)
  const before = tab.past.slice(0, tab.past.findLastIndex((game) => !game.turn?.correction) + 1)
  return (isEmptyCorrection(run) ? before : [...before, tab.game]).slice(-50)
}

// Edits can leave an import's questions with nothing to ask; its read is dropped then, so the Finish
// import card never comes back later over the screenshot's old points.
function settledImport(game: Game): Game {
  if (!game.pendingImport || openImportQuestions(game)) return game
  const { pendingImport: _read, ...rest } = game
  return rest
}

export function reducer(state: StoreState, action: StoreAction): StoreState {
  let next = reduceAction(state, action)
  if (next.activeTabId !== state.activeTabId || ['commit', 'commit-game', 'undo', 'redo'].includes(action.type)) {
    if (next.viewedTurn != null) next = { ...next, viewedTurn: null }
    if (next.historyOpen && !activeTab(next).game.turn) next = { ...next, historyOpen: false }
  }
  if (next === state) return next
  next = withViewedPlayer(next, next.activeTabId !== state.activeTabId ||
    activeTab(next).game.turn?.playerId !== activeTab(state).game.turn?.playerId ? null : next.viewedPlayer ?? null)
  if (next.activeTabId !== state.activeTabId) return withViewedPick(next, null)
  const board = activeTab(next).game.board
  const previous = activeTab(state).game.board
  if (board === previous) return next
  if (board.mePlayerId !== previous.mePlayerId) return withViewedPick(next, null)
  const before = inferDraftState(previous)
  const after = inferDraftState(board)
  const viewedSlot = state.viewedPick ?? before.myRemainingPickIndices[0]

  // The view follows the draft while it is on the earliest open pick.
  if (viewedSlot !== undefined && viewedSlot === before.remainingPickIndices[0]) {
    return withViewedPick(next, after.remainingPickIndices[0] ?? null)
  }
  return next.viewedPick == null ? next : withViewedPick(next, next.viewedPick)
}

function withViewedPlayer(state: StoreState, playerId: string | null): StoreState {
  const { game } = activeTab(state)
  const viewedPlayer = gameStarted(game) && playerId !== game.turn?.playerId &&
    game.board.players.some((player) => player.id === playerId) ? playerId : null
  return viewedPlayer === (state.viewedPlayer ?? null) ? state : { ...state, viewedPlayer }
}

function withViewedPick(state: StoreState, slot: number | null): StoreState {
  const board = activeTab(state).game.board
  const draft = inferDraftState(board)
  const viewedPick = board.mePlayerId !== null && slot !== null &&
    draft.remainingPickIndices.includes(slot) && slot !== draft.myRemainingPickIndices[0]
    ? slot
    : null
  return viewedPick === (state.viewedPick ?? null) ? state : { ...state, viewedPick }
}

function reduceAction(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'view-player':
      return withViewedPlayer(state, action.playerId)
    case 'history':
      if (!action.open && !state.historyOpen) return state
      return { ...state, historyOpen: action.open && activeTab(state).game.turn !== undefined, viewedTurn: null, pick: null, highlight: null }
    case 'view-turn': {
      const { history } = activeTab(state).game
      const count = history?.turns.length ?? 0
      const viewedTurn = state.historyOpen && history && action.index !== null && Number.isInteger(action.index) && action.index >= 0 && action.index <= count
        ? action.index : null
      return viewedTurn === (state.viewedTurn ?? null) ? state : { ...state, viewedTurn }
    }
    case 'view-pick':
      return withViewedPick(state, action.slot)
    case 'commit':
      return updateActiveTab(state, (tab) => {
        const game = settledImport(trackAwards(tab.game, withBoard(tab.game, action.board)))
        if (game === tab.game) return tab
        return {
          ...tab,
          game: closeCorrection(game),
          activePlayerId: activePlayerFor(game.board, tab.activePlayerId),
          past: closeCorrectionRun(tab),
          future: [],
        }
      })
    case 'commit-game':
      return updateActiveTab(state, (tab) => {
        if (action.game === tab.game) return tab
        const next = action.correction ? action.game : closeCorrection(action.game)
        return {
          ...tab,
          game: settledImport(next.awards !== tab.game.awards ? initializeAwards(next) : trackAwards(tab.game, next)),
          // A whole game can carry a different roster (build mode's Cancel
          // restores one), so the id is reconciled as every other write is.
          activePlayerId: activePlayerFor(action.game.board, tab.activePlayerId),
          past: action.correction ? [...tab.past, tab.game].slice(-50) : closeCorrectionRun(tab),
          future: [],
        }
      })
    case 'tool':
      return state.tool.kind === 'none' && action.tool.kind === 'none' ? state : { ...state, tool: action.tool }
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
      // most of all) is a no-op; clearing an already empty highlight would
      // otherwise re-render every consumer of the store.
      return action.marks === state.highlight ? state : { ...state, highlight: action.marks }
    case 'pick':
      return { ...state, pick: action.target }
    case 'pick-clear':
      return state.pick == null ? state : { ...state, pick: null }
    case 'picked':
      return state.pick == null || state.pick.ref !== undefined ? state : { ...state, pick: { ...state.pick, ref: action.ref } }
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
        pick: null,
      }
    }
    case 'tab-select':
      if (!state.tabs.some((tab) => tab.id === action.id)) return state
      return action.id === state.activeTabId ? state : { ...state, activeTabId: action.id, pick: null }
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
        return { ...state, tabs: [tab], activeTabId: tab.id, pick: null }
      }
      if (action.id !== state.activeTabId) return { ...state, tabs }
      return {
        ...state,
        tabs,
        activeTabId: (tabs[index] ?? tabs.at(-1)).id,
        pick: null,
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
        pick: null,
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
const SaveRecoveryContext = createContext<{
  failures: Readonly<Record<string, SaveFailure>>
  retry(): void
  storageFullAttempt: number | null
  dismissStorageFull(): void
  retryAfterCleanup(): void
} | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [failures, setFailures] = useState<Record<string, SaveFailure>>({})
  const [cleanup, setCleanup] = useState<{
    attempt: number
    failures: Readonly<Record<string, SaveFailure>>
    dismissed: boolean
  } | null>(null)
  const reportSave = useCallback<ReportSave>((key, failure) => {
    setFailures((previous) => {
      if (failure === null && !(key in previous)) return previous
      const next = { ...previous }
      if (failure === null) delete next[key]
      else next[key] = failure
      return next
    })
  }, [])
  // Created on the first render, when their reads of shared storage are still
  // this document's own history rather than another document's write.
  const [{ autosave, sync }] = useState(() => ({
    autosave: createLibraryAutosave(dispatch, state.tabs, AUTOSAVE_DELAY, reportSave),
    sync: createWorkspaceSync(dispatch, reportSave),
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
  // The workspace and library were parsed in the first render, so this bundle
  // has booted: the iOS app tells its updater so, then checks for an update.
  useEffect(() => {
    if (import.meta.env.MODE === 'native') {
      void import('../native/ota').then((ota) => ota.startUpdates()).catch((error: unknown) => console.error(error))
    }
  }, [])
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
  // The reducer is pure and the autosave only ever sees tab sets, so a close
  // that must not be rescued is announced to it here, before the close lands.
  const dispatchDiscarding = useCallback((action: StoreAction) => {
    if (action.type === 'tab-close' && action.discard === true) autosave.forget(action.id)
    dispatch(action)
  }, [autosave])
  const value = useMemo(() => ({ state, dispatch: dispatchDiscarding }), [state, dispatchDiscarding])
  const retry = useCallback(() => {
    const linked = autosave.flush()
    sync.arm(persistedWorkspace(linked ?? state.tabs))
    if (sync.flush() === 'deferred') {
      deferred.current = true
      rearm()
    }
  }, [autosave, sync, state.tabs])
  useEffect(() => {
    if (!Object.values(failures).some((failure) => failure.quota)) {
      setCleanup(null)
      return
    }
    if (cleanup !== null) return
    setCleanup({ attempt: 1, failures, dismissed: false })
    try {
      localStorage.removeItem(ANALYSIS_CACHE_KEY)
    } catch {
      // Storage can be blocked between the failed write and cache removal.
    }
    retry()
  }, [failures, cleanup, retry])

  // A deferred retry can leave the old failure visible until a later flush.
  const storageFullAttempt = cleanup !== null && !cleanup.dismissed
    && Object.entries(failures).some(([key, failure]) => failure.quota && failure !== cleanup.failures[key])
    ? cleanup.attempt : null
  const dismissStorageFull = () => setCleanup((previous) => previous && { ...previous, dismissed: true })
  const retryAfterCleanup = () => {
    setCleanup((previous) => ({ attempt: (previous?.attempt ?? 0) + 1, failures, dismissed: false }))
    retry()
  }
  return createElement(SaveRecoveryContext.Provider, {
    value: { failures, retry, storageFullAttempt, dismissStorageFull, retryAfterCleanup },
  },
    createElement(StoreContext.Provider, { value }, children))
}

export function useSaveRecovery() {
  const value = useContext(SaveRecoveryContext)
  if (!value) throw new Error('useSaveRecovery must be used inside StoreProvider')
  return value
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
