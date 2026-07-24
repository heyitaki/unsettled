import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createBoard } from '../model/board'
import { serializeBoard } from '../model/serialization'
import { listMaps, loadMap, renameMap } from '../persistence/localStorage'
import { ConfirmDialog } from './ConfirmDialog'
import { type TabState, useStore } from './store'

function tabIsDirty(tab: TabState): boolean {
  const current = serializeBoard(tab.board)
  const saved = loadMap(tab.title)
  if (saved.ok) return serializeBoard(saved.board) !== current
  return current !== serializeBoard(createBoard(tab.board.layout))
}

export function BoardTabs() {
  const { state, dispatch } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [closingId, setClosingId] = useState<string | null>(null)
  // Fade whichever end of the tab strip hides cut-off tabs. Tabs shrink to a
  // CSS min-width floor first; only once they can't fit does the strip scroll,
  // at which point these flags drive the edge masks.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const syncEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  // Re-measure when the tab set changes or the strip is resized.
  useLayoutEffect(syncEdges, [syncEdges, state.tabs.length])
  // Keep the active tab visible — a newly added or selected tab can land past
  // the scroll edge. scrollIntoView fires a scroll event, so fades re-measure.
  useEffect(() => {
    scrollerRef.current
      ?.querySelector('.board-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.activeTabId, state.tabs.length])
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncEdges])
  const commitEdit = () => {
    const id = editingId
    const next = draft.trim()
    setEditingId(null)
    if (id === null || next.length === 0) return
    const tab = state.tabs.find((candidate) => candidate.id === id)
    if (!tab || next === tab.title) {
      dispatch({ type: 'tab-rename', id, title: next })
      return
    }
    if (state.tabs.some((candidate) => candidate.id !== id && candidate.title === next)) {
      dispatch({ type: 'notice', message: `A board named "${next}" is already open` })
      return
    }
    if (listMaps().maps.some((map) => !map.synthetic && map.name === next)) {
      dispatch({ type: 'notice', message: `A map named "${next}" already exists` })
      return
    }
    if (loadMap(tab.title).ok) {
      const result = renameMap(tab.title, next)
      if (!result.ok) {
        dispatch({ type: 'notice', message: result.error })
        return
      }
    }
    dispatch({ type: 'tab-rename', id, title: next })
  }
  const closingTab = state.tabs.find((tab) => tab.id === closingId)
  return (
    <>
      <div className="board-tabs">
        <div
          ref={scrollerRef}
          className={`board-tabs-scroll ${edges.left ? 'fade-left' : ''} ${edges.right ? 'fade-right' : ''}`}
          role="tablist"
          aria-label="Open boards"
          onScroll={syncEdges}
        >
        {state.tabs.map((tab) => (
          <div className={`board-tab ${tab.id === state.activeTabId ? 'active' : ''}`} key={tab.id}>
            {editingId === tab.id ? (
              // Clicking the active tab drops into an inline rename field.
              <input
                className="board-tab-rename"
                autoFocus
                // Size to the text so the field's intrinsic width matches the
                // truncating select button — otherwise a bare input's wide
                // default inflates the content-sized strip and shifts every tab.
                size={Math.max(draft.length, 1)}
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
                if (tabIsDirty(tab)) setClosingId(tab.id)
                else dispatch({ type: 'tab-close', id: tab.id })
              }}
            >
              ×
            </button>
          </div>
        ))}
        </div>
        <button
          type="button"
          className="board-tab-add"
          aria-label="Add board"
          onClick={() => dispatch({ type: 'tab-add' })}
        >
          +
        </button>
      </div>
      {closingTab && (
        <ConfirmDialog
          title={`Close "${closingTab.title}"?`}
          message="This board has unsaved changes that will be lost."
          actions={[
            {
              label: 'Close board',
              variant: 'danger',
              onClick: () => {
                dispatch({ type: 'tab-close', id: closingTab.id })
                setClosingId(null)
              },
            },
            { label: 'Cancel', onClick: () => setClosingId(null) },
          ]}
          onCancel={() => setClosingId(null)}
        />
      )}
    </>
  )
}
