import type { WorkspaceTab } from '../persistence/localStorage'

export interface SaveFailure {
  message: string
  tab?: WorkspaceTab
}

export type ReportSave = (key: string, failure: SaveFailure | null) => void
