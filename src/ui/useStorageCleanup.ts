import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteMaps, readLibrary, storedTabLinks } from '../persistence/localStorage'
import { CLEANUP_AGE, cleanupCandidates } from '../persistence/storageCleanup'
import { useSaveRecovery, useStore } from './store'

export function useStorageCleanup() {
  const { state, dispatch } = useStore()
  const { failures, storageFullAttempt, retryAfterCleanup } = useSaveRecovery()
  const storageFull = Object.values(failures).some((failure) => failure.quota)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!storageFull) setError(null)
  }, [storageFull])
  const openMaps = useCallback(() => new Set([
    ...state.tabs.map((tab) => tab.mapId), ...storedTabLinks().values(),
  ].filter((id): id is string => id !== null)), [state.tabs])
  const plan = useMemo(() => {
    void state.mapsRevision
    void failures
    const now = Date.now()
    const { candidates, preselected: ids } = storageFull
      ? cleanupCandidates(now, openMaps()) : { candidates: [], preselected: [] }
    const selected = candidates.filter(({ id }) => ids.includes(id))
    return {
      ids,
      count: ids.length,
      oldGames: selected.some(({ lastUsed }) => lastUsed === null || now - lastUsed >= CLEANUP_AGE),
    }
  }, [storageFull, failures, openMaps, state.mapsRevision])
  const games = plan.count === 1 ? 'the game' : `the ${plan.count} games`
  const when = plan.oldGames ? "haven't opened in 30 days" : 'opened least recently'
  const description = `Clean up deletes ${games} you ${when}.`
  const cleanUp = () => {
    setError(null)
    const open = openMaps()
    const result = deleteMaps(plan.ids.filter((id) => !open.has(id)))
    if (!result.ok) {
      setError(`Clean up failed: ${result.error}`)
      return
    }
    dispatch({ type: 'maps-changed', library: readLibrary() })
    retryAfterCleanup()
  }
  return {
    storageFull, plan, description, cleanUp, error,
    promptOpen: storageFullAttempt !== null && plan.count > 0,
  }
}
