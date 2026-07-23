import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react'
import { createBoard } from '../model/board'
import { newId } from '../model/ids'
import type {
  Board,
  BuildingTier,
  Resource,
  TileKind,
} from '../model/types'
import {
  WORKSPACE_KEY,
  loadWorkspace,
  saveWorkspace,
  type PersistedWorkspace,
  type WorkspaceTab,
} from '../persistence/localStorage'

export type Tool =
  | { kind: 'tile'; tile: TileKind }
  | { kind: 'token'; number: number }
  | { kind: 'port'; resource: Resource | null; rate: number }
  | { kind: 'robber' }
  | { kind: 'erase' }
  | { kind: 'piece'; tier: 'road' | BuildingTier }

export interface TabState {
  id: string
  title: string
  board: Board
  past: Board[]
  future: Board[]
  activePlayerId: string
}

export interface StoreState {
  tabs: TabState[]
  activeTabId: string
  tool: Tool
  notice: string | null
  highlight: string | null
}

export type StoreAction =
  | { type: 'commit'; board: Board }
  | { type: 'replace'; board: Board }
  | { type: 'tool'; tool: Tool }
  | { type: 'active-player'; playerId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'notice'; message: string | null }
  | { type: 'highlight'; ref: string | null }
  | { type: 'tab-add'; board?: Board; title?: string; id?: string }
  | { type: 'tab-select'; id: string }
  | { type: 'tab-rename'; id: string; title: string }
  | { type: 'tab-close'; id: string }
  | { type: 'workspace-adopt'; tabs: WorkspaceTab[] }

function createTab(
  board: Board = createBoard('standard4'),
  title: string = 'Board 1',
  id: string = newId(),
  activePlayerId?: string,
): TabState {
  return {
    id,
    title,
    board,
    past: [],
    future: [],
    activePlayerId: activePlayerFor(board, activePlayerId),
  }
}

function initialState(): StoreState {
  const restored = loadWorkspace()
  const tabs = restored.ok
    ? restored.workspace.tabs.map((tab) => createTab(tab.board, tab.title, tab.id, tab.activePlayerId))
    : [createTab()]
  return {
    tabs,
    activeTabId: restored.ok ? restored.workspace.activeTabId : tabs[0].id,
    tool: { kind: 'tile', tile: 'wood' },
    notice: restored.ok ? restored.warning ?? null : null,
    highlight: null,
  }
}

export function activeTab(state: StoreState): TabState {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  if (!tab) throw new Error('Active workspace tab was not found')
  return tab
}

function activePlayerFor(board: Board, activePlayerId?: string): string {
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
        if (action.board === tab.board) return tab
        return {
          ...tab,
          board: action.board,
          past: [...tab.past, tab.board].slice(-50),
          future: [],
        }
      })
    case 'replace':
      return updateActiveTab(state, (tab) => ({
        ...tab,
        board: action.board,
        activePlayerId: activePlayerFor(action.board, tab.activePlayerId),
        past: [...tab.past, tab.board].slice(-50),
        future: [],
      }))
    case 'tool':
      return { ...state, tool: action.tool }
    case 'active-player':
      return updateActiveTab(state, (tab) => ({ ...tab, activePlayerId: action.playerId }))
    case 'undo':
      return updateActiveTab(state, (tab) => {
        const board = tab.past.at(-1)
        if (!board) return tab
        return {
          ...tab,
          board,
          activePlayerId: activePlayerFor(board, tab.activePlayerId),
          past: tab.past.slice(0, -1),
          future: [tab.board, ...tab.future].slice(0, 50),
        }
      })
    case 'redo':
      return updateActiveTab(state, (tab) => {
        const board = tab.future[0]
        if (!board) return tab
        return {
          ...tab,
          board,
          activePlayerId: activePlayerFor(board, tab.activePlayerId),
          past: [...tab.past, tab.board].slice(-50),
          future: tab.future.slice(1),
        }
      })
    case 'notice':
      return { ...state, notice: action.message }
    case 'highlight':
      return { ...state, highlight: action.ref }
    case 'tab-add': {
      const tab = createTab(
        action.board,
        action.title ?? unusedBoardTitle(state.tabs),
        action.id,
      )
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
      const ids = new Set(state.tabs.map((tab) => tab.id))
      const additions: TabState[] = []
      for (const incoming of action.tabs) {
        if (ids.has(incoming.id)) continue
        ids.add(incoming.id)
        additions.push(createTab(
          incoming.board,
          incoming.title,
          incoming.id,
          incoming.activePlayerId,
        ))
      }
      return additions.length === 0
        ? state
        : { ...state, tabs: [...state.tabs, ...additions] }
    }
  }
}

const StoreContext = createContext<{ state: StoreState; dispatch: Dispatch<StoreAction> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const pendingWorkspace = useRef<PersistedWorkspace | null>(null)
  useEffect(() => {
    const workspace: PersistedWorkspace = {
      activeTabId: state.activeTabId,
      tabs: state.tabs.map(({ id, title, board, activePlayerId }) => ({
        id,
        title,
        board,
        activePlayerId,
      })),
    }
    pendingWorkspace.current = workspace
    const timeout = window.setTimeout(() => {
      if (pendingWorkspace.current !== workspace) return
      const result = saveWorkspace(workspace)
      pendingWorkspace.current = null
      if (!result.ok) dispatch({ type: 'notice', message: `Autosave failed: ${result.error}` })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [state.activeTabId, state.tabs])
  useEffect(() => {
    const adoptWorkspace = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_KEY || event.newValue === null) return
      const restored = loadWorkspace()
      if (restored.ok) dispatch({ type: 'workspace-adopt', tabs: restored.workspace.tabs })
    }
    window.addEventListener('storage', adoptWorkspace)
    return () => window.removeEventListener('storage', adoptWorkspace)
  }, [])
  useEffect(() => {
    const flushWorkspace = () => {
      const workspace = pendingWorkspace.current
      if (workspace === null) return
      const result = saveWorkspace(workspace)
      if (pendingWorkspace.current === workspace) pendingWorkspace.current = null
      if (!result.ok) dispatch({ type: 'notice', message: `Autosave failed: ${result.error}` })
    }
    window.addEventListener('pagehide', flushWorkspace)
    return () => window.removeEventListener('pagehide', flushWorkspace)
  }, [])
  const value = useMemo(() => ({ state, dispatch }), [state])
  return createElement(StoreContext.Provider, { value }, children)
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
