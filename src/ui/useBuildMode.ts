import { useEffect, useMemo, useState } from 'react'
import { buildSessionEnded, cancelTarget, openBuildSession, type BuildSession } from './buildMode'
import { viewedPlayerId } from './draftSlots'
import { restingMarks } from './restMarks'
import { activeTab, useStore } from './store'
import { useAnalysis } from './useAnalysis'

/** Snapshots the game on entry. Done keeps edits, Cancel restores, and a tab switch ends the session. */
export function useBuildMode() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { analysis } = useAnalysis()
  const [session, setSession] = useState<BuildSession | null>(null)
  const building = session !== null && !buildSessionEnded(session, tab)
  const { board } = tab.game
  const playerId = viewedPlayerId(board, state.viewedPick)
  const restMarks = useMemo(
    () => building ? null : restingMarks(board, analysis, playerId),
    [board, building, analysis, playerId],
  )

  // Switching tabs keeps the edits and drops the session without a restore.
  useEffect(() => {
    if (session === null || building) return
    setSession(null)
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }, [session, building, dispatch])
  const enter = () => {
    setSession(openBuildSession(tab))
    dispatch({ type: 'history', open: false })
    dispatch({ type: 'tool', tool: { kind: 'piece' } })
  }
  const done = () => {
    setSession(null)
    dispatch({ type: 'tool', tool: { kind: 'none' } })
  }
  const cancel = () => {
    const game = session && cancelTarget(session, tab)
    if (game) dispatch({ type: 'commit-game', game })
    done()
  }
  return { building, enter, done, cancel, toggle: building ? done : enter, restMarks }
}
