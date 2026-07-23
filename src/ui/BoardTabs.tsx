import { useStore } from './store'

export function BoardTabs() {
  const { state, dispatch } = useStore()
  return (
    <div className="board-tabs" role="tablist" aria-label="Open boards">
      {state.tabs.map((tab) => (
        <div className={`board-tab ${tab.id === state.activeTabId ? 'active' : ''}`} key={tab.id}>
          <button
            type="button"
            className="board-tab-select"
            role="tab"
            aria-selected={tab.id === state.activeTabId}
            onClick={() => dispatch({ type: 'tab-select', id: tab.id })}
            onDoubleClick={() => {
              const title = window.prompt('Rename board', tab.title)
              if (title !== null && title.trim().length > 0) {
                dispatch({ type: 'tab-rename', id: tab.id, title })
              }
            }}
          >
            {tab.title}
          </button>
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
