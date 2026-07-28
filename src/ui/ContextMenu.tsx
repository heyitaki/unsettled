import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampToViewport } from './overlayPosition'

export interface ContextMenuItem {
  label: string
  onClick(): void
  /** The chord that runs this item, as this platform writes it; see shortcuts.ts. */
  shortcut?: string
  /** The same chord in ARIA's canonical key names, for `aria-keyshortcuts`. */
  shortcutKeys?: string
  disabled?: boolean
  /** Draws a rule above this item, opening a group. */
  separated?: boolean
}

/** Where the arrow keys can put focus: every item that is not disabled. */
const enabledItems = (menu: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])

type FocusStep = 1 | -1 | 'first' | 'last'

// The menu keyboard pattern its role promises, less Escape and Tab, which are
// handled where they can also close the menu.
const FOCUS_KEYS: Record<string, FocusStep> = {
  ArrowDown: 1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
}

/**
 * A menu pinned to the pointer: the same popup as MenuSelect's, positioned in
 * viewport coordinates and clamped so a right-click near an edge still opens
 * fully on screen. It follows the menu keyboard pattern its role promises —
 * arrows and Home/End move, Escape and Tab leave — and closes on any outside
 * click, on a second right-click, and on the scroll or resize that would
 * otherwise leave it floating away from what it belongs to.
 */
export function ContextMenu({ ariaLabel, x, y, items, onClose }: {
  ariaLabel: string
  x: number
  y: number
  items: readonly ContextMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Held in a ref so the window listeners below bind once: the caller passes a
  // fresh closure on every render of the strip.
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose })
  // Starts at the pointer and settles once measured; a menu is small enough
  // that the correction is invisible, and it cannot be measured unrendered.
  const [at, setAt] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    // clientWidth, not innerWidth: the latter counts a classic scrollbar as
    // usable, which parks the menu underneath it.
    const { clientWidth, clientHeight } = document.documentElement
    const next = clampToViewport(x, y, { width, height }, {
      width: clientWidth,
      height: clientHeight,
    })
    setAt((prev) => (prev.left === next.left && prev.top === next.top ? prev : next))
  }, [x, y])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Bound to the window rather than the menu: a backdrop click leaves focus
      // outside it, and Escape has to keep working from there.
      if (event.key === 'Escape') close.current()
    }
    const onViewportChange = () => close.current()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    // Capture: the menu is fixed to the viewport, so a scroll in any of the
    // page's scrollers slides its board out from under it.
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [])
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    // Focus the first item so the menu is walkable by keyboard from a Shift+F10
    // or context-menu-key opening, where the pointer never moved.
    enabledItems(menuRef.current)[0]?.focus()
    return () => {
      // Hand focus back where it came from — but only if nothing else has taken
      // it. Choosing "Rename" opens the inline field, and that must win.
      const active = document.activeElement
      if (active === null || active === document.body) opener?.focus?.()
    }
  }, [])
  const moveFocus = (step: FocusStep) => {
    const buttons = enabledItems(menuRef.current)
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = step === 'first' ? 0
      : step === 'last' ? buttons.length - 1
      : current < 0 ? (step === 1 ? 0 : buttons.length - 1)
      : (current + step + buttons.length) % buttons.length
    buttons[next].focus()
  }
  return (
    <>
      <button
        type="button"
        className="menu-backdrop"
        // Out of the tab order and out of the accessibility tree: it exists to
        // catch a click, and Escape is the keyboard's way out of the menu.
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        className="menu-popup context-menu"
        role="menu"
        aria-label={ariaLabel}
        style={{ left: at.left, top: at.top }}
        onKeyDown={(event) => {
          const step: FocusStep | undefined = FOCUS_KEYS[event.key]
          if (step !== undefined) {
            event.preventDefault()
            moveFocus(step)
            return
          }
          // Tab dismisses rather than walking out into the page behind the
          // backdrop, which is unreachable by mouse while the menu is up.
          if (event.key === 'Tab') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            // Roving focus: the menu decides who holds it, so no item is a Tab
            // stop of its own.
            tabIndex={-1}
            className={item.separated ? 'separated' : undefined}
            disabled={item.disabled}
            aria-keyshortcuts={item.shortcutKeys}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            <span>{item.label}</span>
            {/* Hidden from the name: read aloud, the glyphs are "place of
                interest sign, erase to the left". aria-keyshortcuts carries it. */}
            {item.shortcut !== undefined && (
              <span className="menu-shortcut" aria-hidden="true">{item.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
