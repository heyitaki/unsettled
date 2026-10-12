import type { useBoardActions } from '../boardActions'
import { DiceGlyph } from '../glyphs'
import { ToolGroups } from '../ToolPalette'
import { UndoRedoButtons } from '../UndoRedoButtons'

/**
 * The board tools in the analysis block's slot. The header dots choose whose
 * pieces the board places while this block is open.
 */
export function PhoneBuild({ actions, onDone, onCancel }: {
  actions: ReturnType<typeof useBoardActions>
  onDone: () => void
  onCancel: () => void
}) {
  const { randomize, clear, chooseLayout } = actions
  return (
    <section className="phone-block phone-block-flush phone-build">
      <div className="phone-block-inner">
        <div className="phone-block-head">
          <h2>Board tools</h2>
          <UndoRedoButtons>
            <button type="button" className="panel-dots" aria-label="Randomize board" data-label="Randomize" onClick={randomize}>
              <DiceGlyph />
            </button>
          </UndoRedoButtons>
        </div>
        <ToolGroups onLayout={chooseLayout} onClear={clear} />
      </div>
      <div className="phone-block-actions">
        <button type="button" className="primary" onClick={onDone}>Done</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}
