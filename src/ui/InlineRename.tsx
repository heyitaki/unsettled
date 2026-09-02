import { useRef } from 'react'

/**
 * A name that renames in place when tapped (spec O3, B6): the button takes
 * only the width of its text, and the field that replaces it grows with what
 * is typed, so the rest of the row stays a select or claim target. Enter and
 * blur commit, Escape reverts.
 */
export function InlineRename({ name, draft, onDraft, onStart, onCommit, onCancel }: {
  name: string
  /** The field's text while renaming, or null when the name is at rest. */
  draft: string | null
  onDraft: (next: string) => void
  /** Absent when the entry cannot be renamed, which leaves the name plain text. */
  onStart?: () => void
  onCommit: () => void
  onCancel: () => void
}) {
  // Enter commits and then the field unmounts; the blur that follows must not
  // commit a second time.
  const settled = useRef(false)
  const finish = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit) onCommit()
    else onCancel()
  }
  if (draft !== null) {
    return (
      <input
        className="list-row-rename"
        autoFocus
        size={Math.max(draft.length, 1)}
        value={draft}
        aria-label={`Rename ${name}`}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(event) => onDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true)
          else if (event.key === 'Escape') finish(false)
        }}
      />
    )
  }
  if (!onStart) return <span className="list-row-name plain">{name}</span>
  return (
    <button
      type="button"
      className="list-row-name"
      aria-label={`Rename ${name}`}
      onClick={() => {
        settled.current = false
        onStart()
      }}
    >
      {name}
    </button>
  )
}
