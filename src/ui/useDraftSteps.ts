import { useState } from 'react'
import { lastDraftPick, removeDraftPick, restoreDraftPick, type DraftPick } from '../engine/draft'
import type { Board } from '../model/types'
import { activeTab, useStore } from './store'

export function useDraftSteps() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab.game
  const [forward, setForward] = useState<{ tabId: string; board: Board; picks: DraftPick[] } | null>(null)

  // Undoing even a player claim must discard the list, though its piece arrays match.
  const valid = forward !== null && forward.tabId === tab.id
    && forward.board.buildings === board.buildings && forward.board.roads === board.roads
    && tab.future.length === 0
  if (forward !== null && !valid) setForward(null)
  const picks = valid ? forward.picks : []
  const last = lastDraftPick(board)
  const commit = (next: Board, remaining: DraftPick[]) => {
    setForward({ tabId: tab.id, board: next, picks: remaining })
    dispatch({ type: 'commit', board: next })
  }

  return {
    canStepBack: last !== null,
    canStepForward: picks.length > 0,
    stepBack: () => {
      if (last) commit(removeDraftPick(board, last), [...picks, last])
    },
    stepForward: () => {
      const pick = picks.at(-1)
      if (pick) commit(restoreDraftPick(board, pick), picks.slice(0, -1))
    },
  }
}
