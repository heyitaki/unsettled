import { useState } from 'react'
import type { CleanupCandidate } from '../persistence/storageCleanup'
import { relativeTime } from './library'
import { ModalDialog } from './ModalDialog'

export function StorageFullDialog({ candidates, preselected, onDelete, onCancel }: {
  candidates: readonly CleanupCandidate[]
  preselected: readonly string[]
  onDelete(ids: string[]): string | null
  onCancel(): void
}) {
  const [checked, setChecked] = useState(() => new Set(preselected))
  const [error, setError] = useState<string | null>(null)
  const selected = candidates.filter(({ id }) => checked.has(id))
  const bytes = selected.reduce((total, candidate) => total + candidate.bytes, 0)
  return (
    <ModalDialog title="Storage is full" className="confirm-dialog storage-full-dialog" onClose={onCancel}>
      <h3>Storage is full</h3>
      <p>This browser has no room left to save your games. Delete old games to make room?</p>
      <ul className="storage-cleanup-list">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <label>
              <input
                type="checkbox"
                aria-label={candidate.name}
                checked={checked.has(candidate.id)}
                onChange={(event) => {
                  const selected = event.currentTarget.checked
                  setChecked((previous) => {
                    const next = new Set(previous)
                    if (selected) next.add(candidate.id)
                    else next.delete(candidate.id)
                    return next
                  })
                }}
              />
              <span>
                {candidate.name}
                <small>{candidate.lastUsed === null ? 'Last use unknown' : `Used ${relativeTime(candidate.lastUsed)}`} · {Math.ceil(candidate.bytes / 1024)} KB</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="primary" disabled={selected.length === 0} onClick={() => {
          setError(onDelete(selected.map(({ id }) => id)))
        }}>Delete {selected.length} {selected.length === 1 ? 'game' : 'games'} · {Math.ceil(bytes / 1024)} KB</button>
        <button type="button" ref={(button) => { if (button) button.autofocus = true }} onClick={onCancel}>Not now</button>
      </div>
    </ModalDialog>
  )
}
