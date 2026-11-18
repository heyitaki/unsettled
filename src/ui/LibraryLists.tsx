import { useMemo, useState } from 'react'
import { gameStage, type GameStage } from '../engine/gameStage'
import { boardColor } from './boardColor'
import { SortGlyph, TrashGlyph } from './glyphs'
import { ListRow } from './ListRow'
import { SORT_MENU_LABEL, SORT_OPTIONS, type SortKey, relativeTime, sortMaps, stampFor } from './library'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore, type TabState } from './store'
import { useLibrary } from './useLibrary'
import { useRenameTab } from './useRenameTab'
import { useScrollEdges } from './useScrollEdges'
import { useStorageCleanup } from './useStorageCleanup'

/** Which name is being renamed, by row key, and the field's text. */
type Editing = { key: string; draft: string }

/**
 * The library's body (spec D1, S7): the one list of boards.
 * Every edited board saves itself into a map, so the list is the saved maps in
 * sort order, with the boards that have no row among them ahead: never saved,
 * or linked to a map the listing cannot show (deleted in another window before
 * the store caught up, or a library that does not read). The board on screen
 * is the `current` row whichever kind it is. The list draws no line between
 * loaded and unloaded maps: opening one that already is just switches.
 * The desktop's Library panel and the phone's Maps screen both render this
 * and differ only in the chrome around it, plus `onNavigate`: on the phone,
 * opening a board takes the screen away with it.
 */
export function LibraryLists({ onNavigate }: { onNavigate?: () => void }) {
  const { state, dispatch } = useStore()
  const renameTab = useRenameTab()
  const { listed, openMap, deleteSavedMap, renameSavedMap } = useLibrary()
  const { storageFull, plan, description, promptOpen, cleanUp, error } = useStorageCleanup()
  const [sortKey, setSortKey] = useState<SortKey>('modifiedAt')
  const [editing, setEditing] = useState<Editing | null>(null)
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
  // An open map's row takes its tab's live stage, which the stored copy trails by the autosave.
  const { unlisted, liveStages } = useMemo(() => {
    const listedIds = new Set(listed.maps.map((map) => map.id))
    const liveStages = new Map<string, GameStage>()
    const unlisted: { tab: TabState; stage: GameStage }[] = []
    for (const tab of state.tabs) {
      const stage = gameStage(tab.game)
      if (tab.mapId !== null) liveStages.set(tab.mapId, stage)
      if (tab.mapId === null || !listedIds.has(tab.mapId)) unlisted.push({ tab, stage })
    }
    return { unlisted, liveStages }
  }, [state.tabs, listed])
  const current = activeTab(state)
  // Legacy data can repeat an id, so the first map wearing the active tab's
  // link is the one current row, by identity.
  const currentMap = current.mapId === null ? undefined : maps.find((map) => map.id === current.mapId)
  // Fade whichever end of the scroller still hides cut-off rows. Its
  // max-height bounds it on the desktop; the phone arms unbound it, where both
  // ends measure flush and no mask is drawn.
  const fades = useScrollEdges<HTMLDivElement>()
  const rowCount = unlisted.length + maps.length
  return (
    <div className="library-boards">
      {storageFull && !promptOpen && <div className="storage-warning" role="status">
        <div className="storage-warning-text">
          <strong>Storage is full</strong>
          <p>Your latest edits are not saved. {plan.count > 0 ? description : 'Delete or export games to make room.'}{error ? ` ${error}` : ''}</p>
        </div>
        {plan.count > 0 && <button type="button" className="storage-warning-action" onClick={cleanUp}>Clean up</button>}
      </div>}
      <div className="group-label">
        <span>Boards ({rowCount})</span>
        <MenuSelect
          ariaLabel="Sort boards"
          value={sortKey}
          options={SORT_OPTIONS}
          onSelect={setSortKey}
          caret={<SortGlyph className="menu-sort-glyph" />}
        >
          {SORT_MENU_LABEL[sortKey]}
        </MenuSelect>
      </div>
      {listed.warning && <p className="hint">{listed.warning}</p>}
      <div
        ref={fades.ref}
        className={`list board-list ${fades.top ? 'fade-top' : ''} ${fades.bottom ? 'fade-bottom' : ''}`}
        onScroll={fades.onScroll}
      >
        {unlisted.map(({ tab, stage }) => {
          const key = `tab:${tab.id}`
          return (
            <ListRow
              key={key}
              current={tab.id === current.id}
              color={boardColor(tab.title)}
              stage={stage}
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
              stage={map.stage === undefined || map.id === null ? undefined : liveStages.get(map.id) ?? map.stage}
              name={map.name || 'empty name'}
              meta={!map.valid ? 'Corrupt' : stamp === undefined ? '' : relativeTime(stamp)}
              selectLabel={`Switch to ${map.name}`}
              selectDisabled={!map.valid}
              // A refused open has toasted why; the list stays for a retry.
              onSelect={() => {
                if (openMap(map)) onNavigate?.()
              }}
              {...rename(key, map.name, (draft) => renameSavedMap(map, draft))}
              // An entry with no name has none to edit.
              onStartRename={map.synthetic === true ? undefined : () => setEditing({ key, draft: map.name })}
              action={{
                label: `Delete ${map.name}`,
                icon: <TrashGlyph />,
                onClick: () => deleteSavedMap(map),
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
