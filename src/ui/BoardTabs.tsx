import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { loadMaps, readLibrary, renameMap } from '../persistence/localStorage'
import { copyTitle, dirtyTabIds, saveTab } from './boardFiles'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  TAB_SHORTCUTS,
  applePlatform,
  ariaKeyShortcut,
  matchesShortcut,
  shortcutLabel,
  type Shortcut,
} from './shortcuts'
import { activeTab, type TabState, useStore } from './store'

/**
 * Is the keystroke going into a field? Board shortcuts stay out of the way of
 * one — F2 and ⌘D would otherwise fire while a tab title is being typed.
 */
const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable)

/**
 * Is anything open over the board? A dialog or a menu owns the keyboard until
 * it is answered, and a chord fired behind one closes a board the user cannot
 * see. Asked of the DOM because there is no app-level overlay state: the port
 * editor, the import dialog and every dropdown belong to components the tab
 * strip knows nothing about. Both backdrop classes, because both kinds block —
 * `.popover-backdrop` dims (ConfirmDialog, ImportDialog, PortPopover) and
 * `.menu-backdrop` is invisible but still swallows every click (MenuSelect,
 * ContextMenu). Called only once a chord has matched, never per keystroke.
 */
const overlayOpen = (): boolean =>
  document.querySelector('.popover-backdrop, .menu-backdrop') !== null

/**
 * Where to open the menu for a contextmenu event. Shift+F10 and the menu key
 * raise the same event with no pointer behind it, and browsers disagree on what
 * they report for it — some say 0,0, which would open the menu in the corner of
 * the screen rather than on the tab it belongs to.
 */
function menuOrigin(event: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY }
  const box = event.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom }
}

const dirtyTabs = (tabs: readonly TabState[]): Set<string> => dirtyTabIds(
  tabs,
  loadMaps(tabs.map((tab) => tab.mapId).filter((id): id is string => id !== null)),
)

/**
 * The boards a close gesture targets, and which of them held unsaved work when
 * it was made — a snapshot, so the prompt keeps describing what it asked about
 * even if a save lands in another window while it is up.
 */
interface ClosePrompt {
  ids: readonly string[]
  dirtyIds: readonly string[]
}

export function BoardTabs() {
  const { state, dispatch } = useStore()
  // ⌘ or Ctrl, and how the menu prints its chords. Read once: a document does
  // not change platforms.
  const [apple] = useState(applePlatform)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [closing, setClosing] = useState<ClosePrompt | null>(null)
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
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
  /**
   * Closes the inline rename, returning the title the tab carries afterwards —
   * or null when the rename was refused and said so, which is the one case
   * where a caller must not go on to report a success over that message.
   */
  const commitEdit = (): string | null => {
    const id = editingId
    const next = draft.trim()
    setEditingId(null)
    const tab = state.tabs.find((candidate) => candidate.id === id)
    // A blank field cancels the rename, leaving the board named as it was.
    if (id === null || next.length === 0) return tab?.title ?? null
    if (!tab || next === tab.title) {
      dispatch({ type: 'tab-rename', id, title: next })
      return next
    }
    // Only a real link may rename a map — titles carry no identity, so a
    // same-named tab that owns nothing cannot rename someone else's map.
    if (tab.mapId !== null) {
      const result = renameMap(tab.mapId, next)
      const library = readLibrary()
      const gone = library.readable && !library.maps.some((map) => map.id === tab.mapId)
      // A map deleted in another window must not block a local rename: unlink
      // and let the tab be renamed, rather than refusing over a map the user
      // cannot see and cannot act on.
      if (!result.ok && !gone) {
        dispatch({ type: 'notice', message: result.error })
        return null
      }
      dispatch({ type: 'maps-changed', library })
    }
    dispatch({ type: 'tab-rename', id, title: next })
    return next
  }
  // dirtyTabs reads the library from localStorage, which React cannot observe;
  // the revision is the cache key for that read, so it belongs in the deps and
  // is read here to say so. Nothing else should be `void`-read this way.
  const dirty = useMemo(() => {
    void state.mapsRevision
    return dirtyTabs(state.tabs)
  }, [state.tabs, state.mapsRevision])
  // One dispatch per board rather than a bulk action: the reducer folds them in
  // order, so each close re-picks the active tab exactly as a lone close does.
  const closeTabs = (ids: readonly string[]) => {
    for (const id of ids) dispatch({ type: 'tab-close', id })
  }
  // Closing boards that hold nothing unsaved needs no confirmation, however
  // many of them the gesture named.
  const requestClose = (ids: readonly string[]) => {
    const dirtyIds = ids.filter((id) => dirty.has(id))
    if (dirtyIds.length === 0) closeTabs(ids)
    else setClosing({ ids, dirtyIds })
  }
  /**
   * Store every unsaved board the close targets, then close the ones that
   * landed. A board whose save failed stays open holding the only copy of its
   * work — closing it anyway is the data loss the prompt exists to prevent.
   */
  const saveAndClose = ({ ids, dirtyIds }: ClosePrompt) => {
    const stuck = new Set<string>()
    const failures: string[] = []
    const saved: string[] = []
    for (const id of dirtyIds) {
      // A board closed in another window while the prompt was up is nothing to
      // save; the close below is a no-op for it too.
      const tab = state.tabs.find((candidate) => candidate.id === id)
      if (tab === undefined) continue
      const result = saveTab(tab)
      if (result.ok) saved.push(result.name)
      else {
        stuck.add(id)
        failures.push(`"${tab.title}": ${result.error}`)
      }
    }
    closeTabs(ids.filter((id) => !stuck.has(id)))
    // The saves landed in localStorage, which React cannot observe; the library
    // panel and the strip's dirty dots re-read off the revision this bumps. Only
    // when something was actually written — the re-read revalidates every board
    // the library holds.
    if (saved.length > 0) dispatch({ type: 'maps-changed', library: readLibrary() })
    // A failure is what needs saying; the boards that did save say so by being
    // gone. Nothing at all to report leaves whatever notice is up alone.
    const message = failures.length > 0
      ? `Could not save ${failures.join('; ')}`
      : saved.length === 1
        ? `Saved "${saved[0]}"`
        : saved.length > 1 ? `Saved ${saved.length} boards` : null
    if (message !== null) dispatch({ type: 'notice', message })
    setClosing(null)
  }
  const saveToLibrary = (tab: TabState) => {
    const result = saveTab(tab)
    if (result.ok) {
      // Attach the tab to the map it landed in, so the next save writes back
      // into that entry rather than making a second copy beside it. The library
      // is re-read after the write, which React cannot observe: every panel
      // reading it re-renders off the revision this bumps. A refused save wrote
      // nothing, and re-reading then costs the whole library a revalidation.
      dispatch({ type: 'tab-link', id: tab.id, mapId: result.id, title: result.name })
      dispatch({ type: 'maps-changed', library: readLibrary() })
    }
    dispatch({ type: 'notice', message: result.ok ? `Saved "${result.name}"` : result.error })
  }
  const duplicate = (tab: TabState) => {
    // The copy dodges saved map names as well as open tab titles, the way the
    // library's own copy names do: a title that already belongs to a map would
    // be renamed under the user the first time the copy is saved.
    const library = readLibrary()
    const taken = new Set([
      ...state.tabs.map((entry) => entry.title),
      ...(library.readable ? library.maps.map((map) => map.name) : []),
    ])
    // Games are immutable and replaced wholesale by every edit, so the copy can
    // share this one. It gets a fresh undo stack and no library link — which is
    // what makes closing it ask to be saved.
    dispatch({
      type: 'tab-add',
      game: tab.game,
      title: copyTitle(tab.title, taken),
      after: tab.id,
    })
  }
  const rename = (tab: TabState) => {
    // The field is the same one clicking the active tab opens, so the board has
    // to become the active one first: this is reachable from a background tab's
    // menu, where the strip would otherwise show a rename field on a board the
    // user is not looking at.
    dispatch({ type: 'tab-select', id: tab.id })
    setDraft(tab.title)
    setEditingId(tab.id)
  }
  const otherTabIds = (tab: TabState) =>
    state.tabs.filter((entry) => entry.id !== tab.id).map((entry) => entry.id)
  const menuItems = (tab: TabState): ContextMenuItem[] => {
    const others = otherTabIds(tab)
    const toTheRight = state.tabs.slice(state.tabs.indexOf(tab) + 1).map((entry) => entry.id)
    // The chords act on the *active* board, so they are only printed on the
    // menu of the active board. On a background tab's menu the same row does
    // something else — "close others" spares the tab you right-clicked, ⌥⌘⌫
    // spares the one you were on — and a chord printed there would be a lie.
    const chord = (shortcut: Shortcut) => tab.id !== state.activeTabId ? {} : {
      shortcut: shortcutLabel(shortcut, apple),
      shortcutKeys: ariaKeyShortcut(shortcut, apple),
    }
    return [
      { label: 'Rename', ...chord(TAB_SHORTCUTS.rename), onClick: () => rename(tab) },
      { label: 'Duplicate', ...chord(TAB_SHORTCUTS.duplicate), onClick: () => duplicate(tab) },
      {
        label: 'Save to library',
        ...chord(TAB_SHORTCUTS.save),
        // Nothing to write when the board already matches its saved map.
        disabled: !dirty.has(tab.id),
        onClick: () => saveToLibrary(tab),
      },
      {
        label: 'Close',
        ...chord(TAB_SHORTCUTS.close),
        separated: true,
        onClick: () => requestClose([tab.id]),
      },
      {
        label: 'Close others',
        ...chord(TAB_SHORTCUTS.closeOthers),
        disabled: others.length === 0,
        onClick: () => requestClose(others),
      },
      // No chord: every combination left is one the browser or the OS owns, and
      // a mis-typed one here closes boards.
      {
        label: 'Close to the right',
        disabled: toTheRight.length === 0,
        onClick: () => requestClose(toTheRight),
      },
    ]
  }
  // The board the open menu belongs to, or undefined once that board is gone —
  // closed here or in another window. The menu is gone with it, so nothing may
  // treat it as still open.
  const menuTab = menu === null
    ? undefined
    : state.tabs.find((tab) => tab.id === menu.tabId)
  /**
   * The board chords, acting on the active board from anywhere in the editor.
   * Held in a ref and bound once: the handler closes over the whole tab set, so
   * re-binding it would re-subscribe the window on every keystroke and edit.
   */
  const onShortcut = (event: KeyboardEvent) => {
    const tab = activeTab(state)
    if (matchesShortcut(event, TAB_SHORTCUTS.save, apple)) {
      // Claimed even while typing, and even behind a dialog: the browser's Save
      // Page dialog has no use over a board.
      event.preventDefault()
      if (overlayOpen()) return
      // A rename in flight is part of what ⌘S means, so commit it first and
      // save under the title that produced — but never over its refusal, which
      // has already been reported and would otherwise be replaced by "Saved".
      const renamed = editingId === tab.id ? commitEdit() : tab.title
      if (renamed === null) return
      // Nothing to write when the board already matches its saved map — the
      // same condition that greys the menu row this chord is printed on. A
      // rename is not board content and has already been persisted by itself.
      if (!dirty.has(tab.id)) {
        dispatch({ type: 'notice', message: `"${renamed}" has no unsaved changes` })
        return
      }
      saveToLibrary({ ...tab, title: renamed })
      return
    }
    const chord = ([
      [TAB_SHORTCUTS.rename, () => rename(tab)],
      [TAB_SHORTCUTS.duplicate, () => duplicate(tab)],
      [TAB_SHORTCUTS.close, () => requestClose([tab.id])],
      [TAB_SHORTCUTS.closeOthers, () => requestClose(otherTabIds(tab))],
    ] as const).find(([shortcut]) => matchesShortcut(event, shortcut, apple))
    if (chord === undefined) return
    // Out of the way of a field — F2 and ⌘D would otherwise fire while a board
    // is being renamed — and of anything open over the board.
    if (isTextEntry(document.activeElement) || overlayOpen()) return
    event.preventDefault()
    chord[1]()
  }
  const latestShortcut = useRef(onShortcut)
  useLayoutEffect(() => { latestShortcut.current = onShortcut })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => latestShortcut.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  const closingTitle = closing === null
    ? ''
    : state.tabs.find((tab) => tab.id === closing.ids[0])?.title ?? ''
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
          <div
            className={`board-tab ${tab.id === state.activeTabId ? 'active' : ''}`}
            key={tab.id}
            // The menu acts on the board that was right-clicked, which need not
            // be the active one — "close others" from a background tab is the
            // whole point of having it.
            onContextMenu={(event) => {
              // The rename field keeps the browser's own menu — cut, paste and
              // spellcheck are what a right-click in a text box is for.
              if (event.target instanceof HTMLInputElement) return
              event.preventDefault()
              setMenu({ tabId: tab.id, ...menuOrigin(event) })
            }}
          >
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
                  if (tab.id === state.activeTabId) rename(tab)
                  else dispatch({ type: 'tab-select', id: tab.id })
                }}
              >
                {tab.title}
                {tab.mapId !== null && dirty.has(tab.id) && (
                  <span className="board-tab-dirty" aria-label="Unsaved changes" title="Unsaved changes">•</span>
                )}
              </button>
            )}
            <button
              type="button"
              className="board-tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => requestClose([tab.id])}
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
      {menu && menuTab && (
        <ContextMenu
          ariaLabel={`${menuTab.title} board menu`}
          x={menu.x}
          y={menu.y}
          items={menuItems(menuTab)}
          onClose={() => setMenu(null)}
        />
      )}
      {closing && (
        <ConfirmDialog
          title={closing.ids.length === 1
            ? `Close "${closingTitle}"?`
            : `Close ${closing.ids.length} boards?`}
          message={closing.ids.length === 1
            ? 'This board has unsaved changes.'
            : `${closing.dirtyIds.length} of them ${closing.dirtyIds.length === 1 ? 'has' : 'have'} unsaved changes.`}
          actions={[
            {
              label: closing.dirtyIds.length === 1 ? 'Save and close' : 'Save all and close',
              variant: 'primary',
              onClick: () => saveAndClose(closing),
            },
            {
              label: 'Discard and close',
              variant: 'danger',
              onClick: () => {
                closeTabs(closing.ids)
                setClosing(null)
              },
            },
            { label: 'Cancel', onClick: () => setClosing(null) },
          ]}
          onCancel={() => setClosing(null)}
        />
      )}
    </>
  )
}
