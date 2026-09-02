import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { boardColor } from './boardColor'
import { PhotoGlyph, PlusGlyph, SortGlyph, TrashGlyph, XMarkGlyph } from './glyphs'
import { ImportDialog } from './ImportDialog'
import { ListRow } from './ListRow'
import { SORT_MENU_LABEL, SORT_OPTIONS, type SortKey, relativeTime, sortMaps, stampFor } from './library'
import { MenuSelect } from './MenuSelect'
import { useStore } from './store'
import { useLibrary } from './useLibrary'
import { useRenameTab } from './useRenameTab'

/** Which name is being renamed: an open tab by id or a saved map by its listing key. */
type Editing = { key: string; draft: string }

/**
 * The library's body (spec D1, S7): import first, then the open boards, then
 * the saved maps. The desktop's Library panel and the phone's Maps screen both
 * render it and differ only in the chrome around it, plus `onNavigate`: on the
 * phone, opening or adding a board takes the screen away with it.
 */
export function LibraryLists({ onNavigate }: { onNavigate?: () => void }) {
  const { state, dispatch } = useStore()
  const renameTab = useRenameTab()
  const { listed, openMap, deleteSavedMap, renameSavedMap } = useLibrary()
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  const [editing, setEditing] = useState<Editing | null>(null)
  // The screenshot dialog closes itself once a parse has landed and also when
  // it is dismissed; only the first should navigate away.
  const [importOpen, setImportOpen] = useState(false)
  const imported = useRef(false)
  const draftFor = (key: string) => (editing?.key === key ? editing.draft : null)
  const rename = (key: string) => ({
    draft: draftFor(key),
    onDraft: (next: string) => setEditing({ key, draft: next }),
    onCancel: () => setEditing(null),
  })
  const maps = useMemo(() => sortMaps(listed.maps, sortKey), [listed, sortKey])
  // Fade whichever end of the saved-map scroller still hides cut-off rows. The
  // rail bounds it on the desktop; the portrait arm unbounds it, where both
  // ends measure flush and no mask is drawn.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [fades, setFades] = useState({ top: false, bottom: false })
  const syncFades = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFades((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [])
  useLayoutEffect(syncFades, [syncFades, maps.length])
  return (
    <>
      <button
        type="button"
        className="hero-import"
        onClick={() => {
          imported.current = false
          setImportOpen(true)
        }}
      >
        <PhotoGlyph />
        Import screenshot
      </button>
      <div>
        <div className="group-label">
          <span>Open boards <span className="count">({state.tabs.length})</span></span>
        </div>
        <div className="list open-boards">
          {state.tabs.map((tab) => (
            <ListRow
              key={tab.id}
              current={tab.id === state.activeTabId}
              color={boardColor(tab.title)}
              name={tab.title}
              selectLabel={`Switch to ${tab.title}`}
              onSelect={() => {
                dispatch({ type: 'tab-select', id: tab.id })
                onNavigate?.()
              }}
              {...rename(tab.id)}
              onStartRename={() => setEditing({ key: tab.id, draft: tab.title })}
              onCommit={() => {
                const draft = draftFor(tab.id)
                setEditing(null)
                if (draft !== null) renameTab(tab, draft)
              }}
              action={{
                label: `Close ${tab.title}`,
                icon: <XMarkGlyph />,
                onClick: () => dispatch({ type: 'tab-close', id: tab.id }),
              }}
            />
          ))}
          <button
            type="button"
            className="list-add"
            onClick={() => {
              dispatch({ type: 'tab-add' })
              onNavigate?.()
            }}
          >
            <PlusGlyph />
            New board
          </button>
        </div>
      </div>
      <div className="library-saved">
        <div className="group-label">
          <span>Saved maps <span className="count">({listed.maps.length})</span></span>
          <MenuSelect
            ariaLabel="Sort saved maps"
            value={sortKey}
            options={SORT_OPTIONS}
            onSelect={setSortKey}
            caret={<SortGlyph className="menu-sort-glyph" />}
          >
            <strong>{SORT_MENU_LABEL[sortKey]}</strong>
          </MenuSelect>
        </div>
        {listed.warning && <p className="hint">{listed.warning}</p>}
        {listed.maps.length === 0 && (
          <p className="hint">No saved maps yet. Boards save themselves as you edit them.</p>
        )}
        <div
          ref={scrollerRef}
          className={`list saved-maps ${fades.top ? 'fade-top' : ''} ${fades.bottom ? 'fade-bottom' : ''}`}
          onScroll={syncFades}
        >
          {maps.map((map, index) => {
            // Legacy data can hold duplicate names, so an entry with no id keys
            // off its position rather than a name that may collide.
            const key = map.id ?? `unaddressable:${index}`
            const stamp = stampFor(map, sortKey)
            return (
              <ListRow
                key={key}
                color={boardColor(map.name)}
                name={map.name || 'empty name'}
                meta={!map.valid ? 'corrupt' : stamp === undefined ? '' : relativeTime(stamp)}
                selectLabel={`Open ${map.name}`}
                selectDisabled={!map.valid}
                // A refused open has toasted why; the list stays for a retry.
                onSelect={() => {
                  if (openMap(map)) onNavigate?.()
                }}
                {...rename(key)}
                // Only an entry with no name at all is beyond addressing; one
                // that merely lacks an id gets stamped on demand.
                onStartRename={map.synthetic === true ? undefined : () => setEditing({ key, draft: map.name })}
                onCommit={() => {
                  const draft = draftFor(key)
                  setEditing(null)
                  if (draft !== null) renameSavedMap(map, draft)
                }}
                action={{
                  label: `Delete ${map.name}`,
                  icon: <TrashGlyph />,
                  disabled: map.synthetic === true,
                  onClick: () => deleteSavedMap(map),
                }}
              />
            )
          })}
        </div>
      </div>
      {importOpen && (
        <ImportDialog
          onImported={() => { imported.current = true }}
          onClose={() => {
            setImportOpen(false)
            if (imported.current) onNavigate?.()
          }}
        />
      )}
    </>
  )
}
