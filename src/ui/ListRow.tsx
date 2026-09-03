import type { ReactNode } from 'react'
import { BoardHexGlyph } from './glyphs'
import { InlineRename } from './InlineRename'

/**
 * A row of the board list (spec S7). The whole row is the select target, laid
 * under the name, which renames in place, and the trailing button. The name field
 * takes only the width of its text, so the rest of the row still selects (O3).
 */
export function ListRow({ current, color, name, meta, selectLabel, selectDisabled, onSelect, draft, onDraft, onStartRename, onCommit, onCancel, action }: {
  current?: boolean
  color: string
  name: string
  meta?: string
  selectLabel: string
  selectDisabled?: boolean
  onSelect: () => void
  /** The rename field's text while renaming, or null when the name is at rest. */
  draft: string | null
  onDraft: (next: string) => void
  /** Absent when the entry cannot be addressed, which leaves the name plain text. */
  onStartRename?: () => void
  onCommit: () => void
  onCancel: () => void
  action: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }
}) {
  return (
    <div className={current ? 'list-row current' : 'list-row'}>
      <button type="button" className="list-row-select" aria-label={selectLabel} disabled={selectDisabled} onClick={onSelect} />
      <BoardHexGlyph color={color} className="list-row-hex" />
      <span className="list-row-main">
        <InlineRename name={name} draft={draft} onDraft={onDraft} onStart={onStartRename} onCommit={onCommit} onCancel={onCancel} />
      </span>
      {meta !== undefined && <span className="list-row-meta">{meta}</span>}
      <button type="button" className="list-row-x" aria-label={action.label} disabled={action.disabled} onClick={action.onClick}>
        {action.icon}
      </button>
    </div>
  )
}
