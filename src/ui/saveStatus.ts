import type { WorkspaceTab } from '../persistence/localStorage'

export interface SaveFailure {
  message: string
  tab?: WorkspaceTab
}

export type ReportSave = (key: string, failure: SaveFailure | null) => void

/**
 * The tabs a recovery export covers: the failed rescues of closed tabs first,
 * then every open tab, so a map reopened since its close writes its newest
 * edits over the stale rescue rather than under it.
 */
export function recoveryTabs(tabs: readonly WorkspaceTab[], failures: Iterable<SaveFailure>): WorkspaceTab[] {
  const closed: WorkspaceTab[] = []
  for (const { tab } of failures) {
    if (tab && !tabs.some((open) => open.id === tab.id)) closed.push(tab)
  }
  return [...closed, ...tabs]
}
