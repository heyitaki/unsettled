export type PaneId = 'board' | 'players' | 'picks' | 'library'

export interface PaneDestination {
  id: PaneId
  label: string
}

export const PANES = [
  { id: 'board', label: 'Board' },
  { id: 'players', label: 'Players' },
  { id: 'picks', label: 'Picks' },
  { id: 'library', label: 'Library' },
] as const satisfies readonly PaneDestination[]
