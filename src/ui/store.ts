import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { createBoard } from '../model/board'
import type {
  Board,
  BuildingTier,
  Resource,
  TileKind,
} from '../model/types'
import { autosaveCurrent, loadCurrent } from '../persistence/localStorage'

export type Tool =
  | { kind: 'tile'; tile: TileKind }
  | { kind: 'token'; number: number }
  | { kind: 'port'; resource: Resource | null; rate: number }
  | { kind: 'robber' }
  | { kind: 'erase' }
  | { kind: 'piece'; tier: 'road' | BuildingTier }

export interface StoreState {
  board: Board
  tool: Tool
  activePlayerId: string
  past: Board[]
  future: Board[]
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

function initialState(): StoreState {
  const restored = loadCurrent()
  const board = restored.ok ? restored.board : createBoard('standard4')
  return {
    board,
    tool: { kind: 'tile', tile: 'wood' },
    activePlayerId: board.players[0].id,
    past: [],
    future: [],
    notice: null,
    highlight: null,
  }
}

function activePlayerFor(board: Board, activePlayerId: string): string {
  return board.players.some((player) => player.id === activePlayerId)
    ? activePlayerId
    : board.players[0].id
}

export function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'commit':
      if (action.board === state.board) return state
      return {
        ...state,
        board: action.board,
        past: [...state.past, state.board].slice(-50),
        future: [],
      }
    case 'replace':
      return {
        ...state,
        board: action.board,
        activePlayerId: activePlayerFor(action.board, state.activePlayerId),
        past: [...state.past, state.board].slice(-50),
        future: [],
      }
    case 'tool':
      return { ...state, tool: action.tool }
    case 'active-player':
      return { ...state, activePlayerId: action.playerId }
    case 'undo': {
      const board = state.past.at(-1)
      if (!board) return state
      return {
        ...state,
        board,
        activePlayerId: activePlayerFor(board, state.activePlayerId),
        past: state.past.slice(0, -1),
        future: [state.board, ...state.future].slice(0, 50),
      }
    }
    case 'redo': {
      const board = state.future[0]
      if (!board) return state
      return {
        ...state,
        board,
        activePlayerId: activePlayerFor(board, state.activePlayerId),
        past: [...state.past, state.board].slice(-50),
        future: state.future.slice(1),
      }
    }
    case 'notice':
      return { ...state, notice: action.message }
    case 'highlight':
      return { ...state, highlight: action.ref }
  }
}

const StoreContext = createContext<{ state: StoreState; dispatch: Dispatch<StoreAction> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const result = autosaveCurrent(state.board)
      if (!result.ok) dispatch({ type: 'notice', message: `Autosave failed: ${result.error}` })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [state.board])
  const value = useMemo(() => ({ state, dispatch }), [state])
  return createElement(StoreContext.Provider, { value }, children)
}

export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}
