import { ArrowLeftGlyph, ArrowRightGlyph } from './glyphs'
import { activeTab, useStore } from './store'

export function UndoRedoButtons() {
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
    </div>
  )
}
