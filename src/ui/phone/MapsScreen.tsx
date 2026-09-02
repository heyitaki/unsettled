import { useMemo, useRef, useState } from 'react'
import { boardColor } from '../boardColor'
import type { ContextMenuItem } from '../ContextMenu'
import {
  ExportGlyph,
  ImportGlyph,
  PhotoGlyph,
  PlusGlyph,
  SortGlyph,
  TrashGlyph,
  XMarkGlyph,
} from '../glyphs'
import { ImportDialog } from '../ImportDialog'
import { ListRow } from '../ListRow'
import { SORT_MENU_LABEL, SORT_OPTIONS, type SortKey, relativeTime, sortMaps, stampFor } from '../library'
import { MenuSelect } from '../MenuSelect'
import { useStore } from '../store'
import { useJsonFiles } from '../useJsonFiles'
import { useLibrary } from '../useLibrary'
import { useRenameTab } from '../useRenameTab'
import { PhoneOverlay } from './PhoneOverlay'

/** Which name is being renamed: an open tab by id or a saved map by its listing key. */
type Editing = { key: string; draft: string }

/**
 * The phone's replacement for the tab strip and the library panel (spec S7):
 * import first, then the open boards, then the saved maps. Selecting, opening,
 * importing and New board act and close the screen; rename, close, delete and
 * sort keep it open.
 */
export function MapsScreen({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const renameTab = useRenameTab()
  const { listed, openMap, deleteSavedMap, renameSavedMap } = useLibrary()
  const { importJson, exportJson, fileInput } = useJsonFiles({ onImported: onClose })
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  const [editing, setEditing] = useState<Editing | null>(null)
  // The screenshot dialog closes itself once a parse has landed and also when
  // it is dismissed; only the first should take this screen with it.
  const [importOpen, setImportOpen] = useState(false)
  const imported = useRef(false)
  const menu: ContextMenuItem[] = [
    { label: 'Import JSON', icon: <ImportGlyph />, onClick: importJson },
    { label: 'Export JSON', icon: <ExportGlyph />, onClick: exportJson },
  ]
  const draftFor = (key: string) => (editing?.key === key ? editing.draft : null)
  const rename = (key: string) => ({
    draft: draftFor(key),
    onDraft: (next: string) => setEditing({ key, draft: next }),
    onCancel: () => setEditing(null),
  })
  const maps = useMemo(() => sortMaps(listed.maps, sortKey), [listed, sortKey])
  return (
    <PhoneOverlay title="Maps" menu={menu} menuLabel="Import and export files" onClose={onClose}>
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
                onClose()
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
              onClose()
            }}
          >
            <PlusGlyph />
            New board
          </button>
        </div>
      </div>
      <div>
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
        <div className="list saved-maps">
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
                  if (openMap(map)) onClose()
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
      {fileInput}
      {importOpen && (
        <ImportDialog
          onImported={() => { imported.current = true }}
          onClose={() => {
            setImportOpen(false)
            if (imported.current) onClose()
          }}
        />
      )}
    </PhoneOverlay>
  )
}
