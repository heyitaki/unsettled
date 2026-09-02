import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { BackGlyph, DotsGlyph } from '../glyphs'
import { isTextEntry, overlayOpen } from '../overlayPosition'

/**
 * A full-screen screen you go to and come back from (spec S7, S8): fixed over
 * the page, sliding in from the right, closed by the back chevron or Escape.
 * The page under it is never scrolled or re-laid out, so it returns exactly as
 * it was. The dots button keeps its slot invisibly when a screen has no menu,
 * so the title sits at the same place on both screens.
 */
export function PhoneOverlay({ title, menu, menuLabel, onClose, children }: {
  title: string
  menu?: readonly ContextMenuItem[]
  menuLabel?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // Held in a ref so the window listener binds once across re-renders.
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose })
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    // Capture phase, so a menu or dialog open over the screen sees Escape first
    // and this listener still finds its backdrop in the DOM and leaves the key
    // to it. A rename field keeps Escape for its own revert.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayOpen() || isTextEntry(document.activeElement)) return
      close.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <section ref={ref} className="phone-overlay" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="phone-overlay-head">
        <button type="button" className="phone-ohead-btn back" aria-label="Back to the board" onClick={onClose}>
          <BackGlyph />
        </button>
        <span className="phone-overlay-title">{title}</span>
        <button
          type="button"
          className={menu ? 'phone-ohead-btn' : 'phone-ohead-btn invisible'}
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(event) => {
            // Hung from the button's bottom-right corner, clear of its round hit area.
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuAt({ x: rect.right + 2, y: rect.bottom + 4 })
          }}
        >
          <DotsGlyph />
        </button>
      </div>
      <div className="phone-overlay-body">{children}</div>
      {menuAt && menu && menuLabel && (
        <ContextMenu
          ariaLabel={menuLabel}
          x={menuAt.x}
          y={menuAt.y}
          align="right"
          tail
          className="sheet-menu-narrow"
          items={menu}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  )
}
