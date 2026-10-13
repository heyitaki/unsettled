import type { useBoardActions } from './boardActions'
import { ToolGroups } from './ToolGroups'
import { UndoRedoButtons } from './UndoRedoButtons'

/**
 * Replaces AnalysisPanel in both trees during build mode.
 * Only className differs between the trees.
 */
export function BoardTools({ className = 'panel tools-panel', actions, onDone, onCancel }: {
  className?: string
  actions: ReturnType<typeof useBoardActions>
  onDone: () => void
  onCancel: () => void
}) {
  const { randomize, clearPieces, clear, chooseLayout } = actions
  return (
    <section className={className}>
      <div className="block-inner">
        <div className="panel-heading">
          <h2>Board tools</h2>
          <UndoRedoButtons />
        </div>
        <ToolGroups onLayout={chooseLayout} onRandomize={randomize} onClearPieces={clearPieces} onClear={clear} />
      </div>
      <div className="block-actions">
        <button type="button" className="primary" onClick={onDone}>Done</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}
