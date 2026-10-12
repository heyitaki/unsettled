import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { clearBoard, isBlank, randomizeBoard, setLayout } from '../model/board'
import { newGame } from '../model/game'
import type { Board, LayoutId } from '../model/types'
import { newBoardTitle } from './boardFiles'
import { ConfirmDialog } from './ConfirmDialog'
import { useStore, type StoreAction, type TabState } from './store'

type Question = { tabId: string } & (
  | { kind: 'randomize' | 'clear' }
  | { kind: 'layout'; layout: LayoutId }
)

export function useBoardActions(tab: TabState, dispatch: Dispatch<StoreAction>) {
  const { state } = useStore()

  // A question about one tab must never act on its replacement.
  const [asking, setAsking] = useState<Question | null>(null)
  useEffect(() => setAsking(null), [tab.id])
  const { board } = tab.game
  const close = () => setAsking(null)

  const dealt = useRef<Board | null>(null)
  const deal = () => (dealt.current = randomizeBoard(board))
  const commit = (next: Board) => {
    dispatch({ type: 'commit', board: next })
    close()
  }
  let confirm: ReactNode = null
  if (asking?.tabId === tab.id) {
    if (asking.kind === 'randomize') {
      confirm = (
        <ConfirmDialog
          title="Randomize this board?"
          message="Replace swaps this board's tiles, tokens, ports and pieces for a random map. New board keeps this one and deals the random map on a new board. Your players are kept either way."
          actions={[
            { label: 'Replace', variant: 'danger', onClick: () => commit(deal()) },
            {
              label: 'New board',
              variant: 'primary',
              onClick: () => {
                dispatch({ type: 'tab-add', game: newGame(deal()), title: newBoardTitle(state.tabs) })
                close()
              },
            },
            { label: 'Cancel', onClick: close },
          ]}
          onCancel={close}
        />
      )
    } else if (asking.kind === 'clear') {
      confirm = (
        <ConfirmDialog
          title="Clear this board?"
          message="Clearing removes the tiles, tokens, and pieces on this board and puts its ports back. Your players are kept."
          actions={[
            { label: 'Clear board', variant: 'danger', onClick: () => commit(clearBoard(board)) },
            { label: 'Cancel', onClick: close },
          ]}
          onCancel={close}
        />
      )
    } else if (asking.kind === 'layout') {
      confirm = (
        <ConfirmDialog
          title="Change layout?"
          message="Switching layouts clears the tiles, tokens, and pieces on this board. Your players are kept."
          actions={[
            { label: 'Change layout', variant: 'danger', onClick: () => commit(setLayout(board, asking.layout)) },
            { label: 'Cancel', onClick: close },
          ]}
          onCancel={close}
        />
      )
    }
  }
  return {
    randomize: () => {
      if (isBlank(board) || board === dealt.current) dispatch({ type: 'commit', board: deal() })
      else setAsking({ tabId: tab.id, kind: 'randomize' })
    },
    clear: () => {
      if (!isBlank(board)) setAsking({ tabId: tab.id, kind: 'clear' })
    },
    chooseLayout: (layout: LayoutId) => {
      if (layout === board.layout) return
      if (isBlank(board)) dispatch({ type: 'commit', board: setLayout(board, layout) })
      else setAsking({ tabId: tab.id, kind: 'layout', layout })
    },
    confirm,
  }
}
