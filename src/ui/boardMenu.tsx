import { useRef, useState, type Dispatch, type ReactNode } from 'react'
import { clearBoard, isBlank, randomizeBoard } from '../model/board'
import { newGame } from '../model/game'
import { ConfirmDialog } from './ConfirmDialog'
import type { ContextMenuItem } from './ContextMenu'
import { ClearBoardGlyph, DiceGlyph, RedoGlyph, UndoGlyph } from './glyphs'
import type { Board } from '../model/types'
import type { StoreAction, TabState } from './store'

export function useBoardMenu(tab: TabState, dispatch: Dispatch<StoreAction>): {
  history: ContextMenuItem[]
  randomize: ContextMenuItem
  clear: ContextMenuItem
  /** The randomize question, to render while it is open. */
  confirm: ReactNode
} {
  const [asking, setAsking] = useState(false)
  const { board } = tab.game
  const close = () => setAsking(false)
  // The last map dealt here. While a board is still that very map, dealing again loses nothing.
  const dealt = useRef<Board | null>(null)
  const deal = () => (dealt.current = randomizeBoard(board))
  return {
    history: [
      { label: 'Undo', icon: <UndoGlyph />, disabled: tab.past.length === 0, onClick: () => dispatch({ type: 'undo' }) },
      { label: 'Redo', icon: <RedoGlyph />, disabled: tab.future.length === 0, onClick: () => dispatch({ type: 'redo' }) },
    ],
    randomize: {
      label: 'Randomize board',
      icon: <DiceGlyph />,
      // Like the layout switch: a blank board has nothing to lose, so only a filled one asks.
      onClick: () => {
        if (isBlank(board) || board === dealt.current) dispatch({ type: 'commit', board: deal() })
        else setAsking(true)
      },
    },
    clear: {
      label: 'Clear board',
      icon: <ClearBoardGlyph />,
      danger: true,
      onClick: () => dispatch({ type: 'commit', board: clearBoard(board) }),
    },
    confirm: asking && (
      <ConfirmDialog
        title="Randomize this board?"
        message="Replace swaps this board's tiles, tokens, ports and pieces for a random map. New board keeps this one and deals the random map on a new board. Your players are kept either way."
        actions={[
          {
            label: 'Replace',
            variant: 'danger',
            onClick: () => {
              dispatch({ type: 'commit', board: deal() })
              close()
            },
          },
          {
            label: 'New board',
            variant: 'primary',
            onClick: () => {
              dispatch({ type: 'tab-add', game: newGame(deal()) })
              close()
            },
          },
          { label: 'Cancel', onClick: close },
        ]}
        onCancel={close}
      />
    ),
  }
}
