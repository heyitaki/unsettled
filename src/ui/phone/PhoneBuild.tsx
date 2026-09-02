import { ToolGroups } from '../ToolPalette'

/**
 * The board tools in the analysis block's slot (spec S6). Randomize, clear,
 * undo and redo are not repeated here; the header's dots menu holds them.
 */
export function PhoneBuild({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  return (
    <section className="phone-block phone-block-flush phone-build">
      <div className="phone-block-inner">
        <div className="phone-block-head">
          <div>
            <span className="eyebrow">Build mode</span>
            <h2>Board tools</h2>
          </div>
        </div>
        <ToolGroups />
      </div>
      <div className="phone-block-actions">
        <button type="button" className="primary" onClick={onDone}>Done</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}
