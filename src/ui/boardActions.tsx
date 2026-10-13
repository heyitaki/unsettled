import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { clearBoard, clearPieces, isBlank, randomizeBoard, setLayout } from '../model/board'
import { newGame } from '../model/game'
import type { Board, LayoutId } from '../model/types'
import { newBoardTitle } from './boardFiles'
import { ConfirmDialog } from './ConfirmDialog'
import { useStore, type StoreAction, type TabState } from './store'

type Question = { tabId: string } & (
  | { kind: 'randomize' | 'clear' | 'clearPieces' }
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
  const reset = (next: Board) => {
    dispatch({ type: 'commit-game', game: newGame(next) })
    close()
  }
  let confirm: ReactNode = null
  if (asking?.tabId === tab.id) {
    if (asking.kind === 'randomize') {
      confirm = (
        <ConfirmDialog
          title="Randomize this board?"
          message="Replace swaps this board's tiles, tokens, ports and pieces for a random map and resets recorded turns, hands, development cards and awards. New board keeps this one and deals the random map on a new board. Your players are kept either way."
          actions={[
            { label: 'Replace', variant: 'danger', onClick: () => reset(deal()) },
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
    } else if (asking.kind === 'clear' || asking.kind === 'clearPieces') {
      const pieces = asking.kind === 'clearPieces'
      confirm = (
        <ConfirmDialog
          title={pieces ? 'Clear the pieces?' : 'Clear this board?'}
          message={pieces
            ? 'This removes every settlement, city and road. The game goes back to before the draft: recorded turns, hands, development cards and awards are reset. The tiles, numbers, ports and robber stay, and so do your players. Undo brings everything back.'
            : 'This removes every tile and number, every settlement, city and road, and the robber, and puts the ports back where a new board has them. The game goes back to before the draft: recorded turns, hands, development cards and awards are reset. Your players stay. Undo brings everything back.'}
          actions={[
            {
              label: pieces ? 'Clear pieces' : 'Clear board',
              variant: 'danger',
              onClick: () => reset(pieces ? clearPieces(board) : clearBoard(board)),
            },
            { label: 'Cancel', onClick: close },
          ]}
          onCancel={close}
        />
      )
    } else if (asking.kind === 'layout') {
      confirm = (
        <ConfirmDialog
          title="Change layout?"
          message="Switching layouts clears the tiles, tokens, and pieces on this board and resets recorded turns, hands, development cards and awards. Your players are kept."
          actions={[
            { label: 'Change layout', variant: 'danger', onClick: () => reset(setLayout(board, asking.layout)) },
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
    clearPieces: () => setAsking({ tabId: tab.id, kind: 'clearPieces' }),
    clear: () => setAsking({ tabId: tab.id, kind: 'clear' }),
    chooseLayout: (layout: LayoutId) => {
      if (layout === board.layout) return
      if (isBlank(board)) dispatch({ type: 'commit', board: setLayout(board, layout) })
      else setAsking({ tabId: tab.id, kind: 'layout', layout })
    },
    confirm,
  }
}
