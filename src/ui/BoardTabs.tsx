import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readLibrary } from '../persistence/localStorage'
import { copyTitle } from './boardFiles'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  TAB_SHORTCUTS,
  applePlatform,
  ariaKeyShortcut,
  matchesShortcut,
  shortcutLabel,
  type Shortcut,
} from './shortcuts'
import { isTextEntry, overlayOpen } from './overlayPosition'
import { activeTab, type TabState, useStore } from './store'
import { useCoarsePointer } from './useMediaQuery'
import { useRenameTab } from './useRenameTab'

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

export function BoardTabs() {
  const { state, dispatch } = useStore()
  const coarse = useCoarsePointer()
  // ⌘ or Ctrl, and how the menu prints its chords. Read once: a document does
  // not change platforms.
  const [apple] = useState(applePlatform)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const longPress = useRef<{
    timer: number
    x: number
    y: number
  } | null>(null)
  const suppressClick = useRef(false)
  const cancelLongPress = () => {
    if (longPress.current !== null) window.clearTimeout(longPress.current.timer)
    longPress.current = null
  }
  useEffect(() => cancelLongPress, [])
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
  const renameTab = useRenameTab()
  /**
   * Closes the inline rename, returning the title the tab carries afterwards,
   * or null when the rename was refused and said so, so a caller never reports
   * a success over that message.
   */
  const commitEdit = (): string | null => {
    const id = editingId
    setEditingId(null)
    const tab = state.tabs.find((candidate) => candidate.id === id)
    return tab ? renameTab(tab, draft) : null
  }
  // One dispatch per board rather than a bulk action: the reducer folds them in
  // order, so each close re-picks the active tab exactly as a lone close does.
  // No confirmation: boards save themselves, so a close never loses work.
  const closeTabs = (ids: readonly string[]) => {
    for (const id of ids) dispatch({ type: 'tab-close', id })
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
    // share this one. It gets a fresh undo stack and no library link, so its
    // first edit autosaves into a map of its own.
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
        label: 'Close',
        ...chord(TAB_SHORTCUTS.close),
        separated: true,
        onClick: () => closeTabs([tab.id]),
      },
      {
        label: 'Close others',
        ...chord(TAB_SHORTCUTS.closeOthers),
        disabled: others.length === 0,
        onClick: () => closeTabs(others),
      },
      // No chord: every combination left is one the browser or the OS owns, and
      // a mis-typed one here closes boards.
      {
        label: 'Close to the right',
        disabled: toTheRight.length === 0,
        onClick: () => closeTabs(toTheRight),
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
    const chord = ([
      [TAB_SHORTCUTS.rename, () => rename(tab)],
      [TAB_SHORTCUTS.duplicate, () => duplicate(tab)],
      [TAB_SHORTCUTS.close, () => closeTabs([tab.id])],
      [TAB_SHORTCUTS.closeOthers, () => closeTabs(otherTabIds(tab))],
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
            onPointerDown={(event) => {
              if (!coarse || event.target instanceof HTMLInputElement) return
              cancelLongPress()
              suppressClick.current = false
              const { clientX: x, clientY: y } = event
              const timer = window.setTimeout(() => {
                longPress.current = null
                suppressClick.current = true
                setMenu({ tabId: tab.id, x, y })
              }, 500)
              longPress.current = { timer, x, y }
            }}
            onPointerMove={(event) => {
              const press = longPress.current
              if (press === null || Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 10) return
              cancelLongPress()
            }}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onClickCapture={(event) => {
              if (!suppressClick.current) return
              event.preventDefault()
              event.stopPropagation()
              suppressClick.current = false
            }}
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
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
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
              </button>
            )}
            <button
              type="button"
              className="board-tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => closeTabs([tab.id])}
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
    </>
  )
}
