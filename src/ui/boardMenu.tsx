import type { Dispatch } from 'react'
import { clearBoard, randomizeBoard } from '../model/board'
import type { ContextMenuItem } from './ContextMenu'
import { ClearBoardGlyph, DiceGlyph, RedoGlyph, UndoGlyph } from './glyphs'
import type { StoreAction, TabState } from './store'

export function boardMenu(tab: TabState, dispatch: Dispatch<StoreAction>): {
  history: ContextMenuItem[]
  items: ContextMenuItem[]
} {
  return {
    history: [
      { label: 'Undo', icon: <UndoGlyph />, disabled: tab.past.length === 0, onClick: () => dispatch({ type: 'undo' }) },
      { label: 'Redo', icon: <RedoGlyph />, disabled: tab.future.length === 0, onClick: () => dispatch({ type: 'redo' }) },
    ],
    items: [
      {
        label: 'Randomize board',
        icon: <DiceGlyph />,
        onClick: () => dispatch({ type: 'commit', board: randomizeBoard(tab.game.board) }),
      },
      {
        label: 'Clear board',
        icon: <ClearBoardGlyph />,
        danger: true,
        onClick: () => dispatch({ type: 'commit', board: clearBoard(tab.game.board) }),
      },
    ],
  }
}
