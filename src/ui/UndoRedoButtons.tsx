import type { ReactNode } from 'react'
import { ArrowLeftGlyph, ArrowRightGlyph } from './glyphs'
import { activeTab, useStore } from './store'

/** The undo and redo heading buttons, followed by any extra heading buttons. */
export function UndoRedoButtons({ children }: { children?: ReactNode }) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  return (
    <div className="panel-actions">
      <button
        type="button"
        className="panel-dots"
        aria-label="Undo"
        data-label="Undo"
        disabled={tab.past.length === 0}
        onClick={() => dispatch({ type: 'undo' })}
      >
        <ArrowLeftGlyph />
      </button>
      <button
        type="button"
        className="panel-dots"
        aria-label="Redo"
        data-label="Redo"
        disabled={tab.future.length === 0}
        onClick={() => dispatch({ type: 'redo' })}
      >
        <ArrowRightGlyph />
      </button>
      {children}
    </div>
  )
}
