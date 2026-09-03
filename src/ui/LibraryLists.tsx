import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { boardColor } from './boardColor'
import { PhotoGlyph, PlusGlyph, SortGlyph, TrashGlyph } from './glyphs'
import { ImportDialog } from './ImportDialog'
import { ListRow } from './ListRow'
import { SORT_MENU_LABEL, SORT_OPTIONS, type SortKey, relativeTime, sortMaps, stampFor } from './library'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore } from './store'
import { useLibrary } from './useLibrary'
import { useRenameTab } from './useRenameTab'

/** Which name is being renamed, by row key, and the field's text. */
type Editing = { key: string; draft: string }

/**
 * The library's body (spec D1, S7): import first, then the one list of boards.
 * Every edited board saves itself into a map, so the list is the saved maps in
 * sort order, with the boards that have no row among them ahead: never saved,
 * or linked to a map the listing cannot show (deleted in another window before
 * the store caught up, or a library that does not read). The board on screen
 * is the `current` row whichever kind it is. The list draws no line between
 * loaded and unloaded maps: opening one that already is just switches.
 * The desktop's Library panel and the phone's Maps screen both render this
 * and differ only in the chrome around it, plus `onNavigate`: on the phone,
 * opening or adding a board takes the screen away with it.
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
  // The in-place rename of one row, keyed so only that row's field is open.
  // The field is closed before the commit lands, so a refused rename cannot
  // leave it up over the old name.
  const rename = (key: string, name: string, commit: (draft: string) => void) => ({
    draft: editing?.key === key ? editing.draft : null,
    onDraft: (next: string) => setEditing({ key, draft: next }),
    onStartRename: () => setEditing({ key, draft: name }),
    onCommit: () => {
      const draft = editing?.key === key ? editing.draft : null
      setEditing(null)
      if (draft !== null) commit(draft)
    },
    onCancel: () => setEditing(null),
  })
  const maps = useMemo(() => sortMaps(listed.maps, sortKey), [listed, sortKey])
  const listedIds = new Set(listed.maps.map((map) => map.id))
  const unlisted = state.tabs.filter((tab) => tab.mapId === null || !listedIds.has(tab.mapId))
  const current = activeTab(state)
  // Legacy data can repeat an id, so the first map wearing the active tab's
  // link is the one current row, by identity.
  const currentMap = current.mapId === null ? undefined : maps.find((map) => map.id === current.mapId)
  // Fade whichever end of the scroller still hides cut-off rows. Its
  // max-height bounds it on the desktop; the phone arms unbound it, where both
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
  // The row count covers the rows the scroller holds; the observer covers its
  // height, which moves with the rail around it.
  const rowCount = unlisted.length + maps.length
  useLayoutEffect(() => {
    syncFades()
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(syncFades)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncFades, rowCount])
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
      <div className="library-boards">
        <div className="group-label">
          <span>Boards <span className="count">({rowCount})</span></span>
          <MenuSelect
            ariaLabel="Sort boards"
            value={sortKey}
            options={SORT_OPTIONS}
            onSelect={setSortKey}
            caret={<SortGlyph className="menu-sort-glyph" />}
          >
            <strong>{SORT_MENU_LABEL[sortKey]}</strong>
          </MenuSelect>
        </div>
        {listed.warning && <p className="hint">{listed.warning}</p>}
        <div
          ref={scrollerRef}
          className={`list board-list ${fades.top ? 'fade-top' : ''} ${fades.bottom ? 'fade-bottom' : ''}`}
          onScroll={syncFades}
        >
          {unlisted.map((tab) => {
            const key = `tab:${tab.id}`
            return (
              <ListRow
                key={key}
                current={tab.id === current.id}
                color={boardColor(tab.title)}
                name={tab.title}
                selectLabel={`Switch to ${tab.title}`}
                onSelect={() => {
                  dispatch({ type: 'tab-select', id: tab.id })
                  onNavigate?.()
                }}
                {...rename(key, tab.title, (draft) => renameTab(tab, draft))}
                action={{
                  label: `Delete ${tab.title}`,
                  icon: <TrashGlyph />,
                  // Discarded, not closed: an edit still inside the debounce
                  // would otherwise be rescued into a new map, and the row the
                  // user just deleted would come straight back as a saved one.
                  onClick: () => dispatch({ type: 'tab-close', id: tab.id, discard: true }),
                }}
              />
            )
          })}
          {maps.map((map) => {
            // Legacy data can hold duplicate names, so an entry with no id keys
            // off its stored position rather than a name that may collide.
            const key = `map:${map.id ?? `unaddressable:${map.index}`}`
            const stamp = stampFor(map, sortKey)
            return (
              <ListRow
                key={key}
                current={map === currentMap}
                color={boardColor(map.name)}
                name={map.name || 'empty name'}
                meta={!map.valid ? 'corrupt' : stamp === undefined ? '' : relativeTime(stamp)}
                selectLabel={`Switch to ${map.name}`}
                selectDisabled={!map.valid}
                // A refused open has toasted why; the list stays for a retry.
                onSelect={() => {
                  if (openMap(map)) onNavigate?.()
                }}
                {...rename(key, map.name, (draft) => renameSavedMap(map, draft))}
                // Only an entry with no name at all is beyond addressing; one
                // that merely lacks an id gets stamped on demand.
                onStartRename={map.synthetic === true ? undefined : () => setEditing({ key, draft: map.name })}
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
