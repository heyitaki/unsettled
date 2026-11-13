import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSaveRecovery, useStore } from './store'
import { createLibraryBackup } from '../persistence/backup'
import { downloadBoard } from './boardFiles'
import { recoveryTabs } from './saveStatus'
import { persistedWorkspace } from './workspaceSync'
import { deleteMaps, readLibrary, storedTabLinks } from '../persistence/localStorage'
import { cleanupCandidates } from '../persistence/storageCleanup'
import { StorageFullDialog } from './StorageFullDialog'

/**
 * The toast, rendered by both shells so a notice reads the same wherever it is
 * raised. Always mounted: it owns the auto-dismiss timer and the
 * `unsettled:notice` window event that code outside React uses to speak.
 */
export function GlobalNotice() {
  const { state, dispatch } = useStore()
  const { failures, retry, storageFullAttempt, dismissStorageFull, retryAfterCleanup } = useSaveRecovery()
  const errors = Object.values(failures)
  const openMaps = useCallback(() => new Set([
    ...state.tabs.map((tab) => tab.mapId), ...storedTabLinks().values(),
  ].filter((id): id is string => id !== null)), [state.tabs])
  const cleanup = useMemo(() => {
    void state.mapsRevision
    return Object.values(failures).some((failure) => failure.quota)
      ? cleanupCandidates(Date.now(), openMaps()) : { candidates: [], preselected: [] }
  }, [failures, openMaps, state.mapsRevision])
  const [backupError, setBackupError] = useState<string | null>(null)
  // Pause auto-dismiss while the pointer is over the toast, so it can be read,
  // clicked, and text-selected; the timer restarts fresh once the pointer leaves.
  const [hover, setHover] = useState(false)
  // Keyed on noticeSeq so an identical repeat message still restarts the timer.
  useEffect(() => {
    if (!state.notice || hover) return
    const timeout = window.setTimeout(() => dispatch({ type: 'notice', message: null }), 1000)
    return () => window.clearTimeout(timeout)
  }, [state.notice, state.noticeSeq, hover, dispatch])
  useEffect(() => {
    const showNotice = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      dispatch({ type: 'notice', message: event.detail })
    }
    window.addEventListener('unsettled:notice', showNotice)
    return () => window.removeEventListener('unsettled:notice', showNotice)
  }, [dispatch])
  if (errors.length > 0) return (
    <>
      {storageFullAttempt !== null && cleanup.candidates.length > 0 && <StorageFullDialog
        key={storageFullAttempt}
        {...cleanup}
        onCancel={dismissStorageFull}
        onDelete={(ids) => {
          const open = openMaps()
          const result = deleteMaps(ids.filter((id) => !open.has(id)))
          if (!result.ok) return result.error
          dispatch({ type: 'maps-changed', library: readLibrary() })
          retryAfterCleanup()
          return null
        }}
      />}
      <div className="global-notice save-failure" role="alert">
        <div>
          {errors.map((error, index) => <p key={index}>{error.message}</p>)}
          {errors.some((error) => error.quota) && cleanup.candidates.length === 0
            && <p>Delete or export old games to make room.</p>}
          {backupError && <p>{backupError}</p>}
          <button type="button" onClick={retry}>Retry saving</button>
          <button type="button" onClick={() => {
            try {
              downloadBoard('unsettled-library-backup', createLibraryBackup(recoveryTabs(persistedWorkspace(state.tabs).tabs, errors)))
              setBackupError(null)
            } catch (error) {
              setBackupError(`Backup failed: ${error instanceof Error ? error.message : 'Unable to export backup'}`)
            }
          }}>Export backup</button>
        </div>
      </div>
    </>
  )
  if (!state.notice) return null
  return (
    <div
      className="global-notice"
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="global-notice-text">{state.notice}</span>
      <button
        type="button"
        className="global-notice-close"
        aria-label="Dismiss notification"
        // Closing unmounts the toast without firing onMouseLeave, so clear the
        // hover flag here or the next notice would never auto-dismiss.
        onClick={() => {
          setHover(false)
          dispatch({ type: 'notice', message: null })
        }}
      >
        ×
      </button>
    </div>
  )
}
