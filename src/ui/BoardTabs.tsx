import { useState } from 'react'
import { useStore } from './store'

export function BoardTabs() {
  const { state, dispatch } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const commitEdit = () => {
    if (editingId !== null && draft.trim().length > 0) {
      dispatch({ type: 'tab-rename', id: editingId, title: draft.trim() })
    }
    setEditingId(null)
  }
  return (
    <div className="board-tabs" role="tablist" aria-label="Open boards">
      {state.tabs.map((tab) => (
        <div className={`board-tab ${tab.id === state.activeTabId ? 'active' : ''}`} key={tab.id}>
          {editingId === tab.id ? (
            // Clicking the active tab drops into an inline rename field.
            <input
              className="board-tab-rename"
              autoFocus
              value={draft}
              aria-label={`Rename ${tab.title}`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                else if (event.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="board-tab-select"
              role="tab"
              aria-selected={tab.id === state.activeTabId}
              onClick={() => {
                if (tab.id === state.activeTabId) {
                  setDraft(tab.title)
                  setEditingId(tab.id)
                } else dispatch({ type: 'tab-select', id: tab.id })
              }}
            >
              {tab.title}
            </button>
          )}
          <button
            type="button"
            className="board-tab-close"
            aria-label={`Close ${tab.title}`}
            onClick={() => {
              if (window.confirm('Close this board?')) dispatch({ type: 'tab-close', id: tab.id })
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="board-tab-add"
        aria-label="Add board"
        onClick={() => dispatch({ type: 'tab-add' })}
      >
        +
      </button>
    </div>
  )
}
