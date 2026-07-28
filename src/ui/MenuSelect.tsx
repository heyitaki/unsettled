import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { placeBelow } from './overlayPosition'

/** How long a typed prefix keeps accumulating before the next key starts over. */
const TYPEAHEAD_RESET_MS = 500

/** The active option's id, stable per position so aria-activedescendant can name it. */
const optionId = (baseId: string, index: number) => `${baseId}-option-${index}`

/**
 * The shared popup-listbox dropdown: a transparent trigger showing the current
 * value, a fixed full-screen backdrop that closes on any outside click, and an
 * absolutely-positioned option menu. Used by the board header's layout picker
 * and the analysis panel's "You are …" selector so both look identical.
 *
 * Keyboard: the popup itself takes focus and holds the single tab stop, moving
 * an `aria-activedescendant` marker rather than focus between options — so the
 * options are not tab stops, and a screen reader announces the active one
 * without the listbox losing its own identity. Arrows clamp at the ends the way
 * a native `<select>` does; only typeahead wraps, since a prefix search that
 * stopped at the last option would be unable to find half the list.
 */
export function MenuSelect<T extends string>({ ariaLabel, value, options, onSelect, children }: {
  ariaLabel: string
  value: T | null
  options: readonly { value: T; label: string }[]
  onSelect: (value: T) => void
  /** Trigger content; the ▾ affordance is appended by this component. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const baseId = useId()
  const labelId = `${baseId}-label`
  const triggerId = `${baseId}-trigger`
  const popupId = `${baseId}-popup`
  const wrapRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ prefix: '', at: 0 })
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const wrap = wrapRef.current
    const trigger = triggerRef.current
    const popup = popupRef.current
    if (!wrap || !trigger || !popup) return
    const wrapBox = wrap.getBoundingClientRect()
    const triggerBox = trigger.getBoundingClientRect()
    const popupBox = popup.getBoundingClientRect()
    // clientWidth excludes a classic scrollbar, which is not usable popup space.
    const { clientWidth, clientHeight } = document.documentElement
    const placed = placeBelow({
      left: triggerBox.left,
      top: triggerBox.top - 6,
      bottom: triggerBox.bottom + 6,
    }, popupBox, {
      width: clientWidth,
      height: clientHeight,
    })
    setAt({ left: placed.left - wrapBox.left, top: placed.top - wrapBox.top })
  }, [open, options.length])
  // preventScroll: the popup is already beside its trigger, and letting focus
  // scroll to the not-yet-positioned first paint would jolt the page.
  useEffect(() => {
    if (open) popupRef.current?.focus({ preventScroll: true })
  }, [open])
  // The marker can outrun the list if that list shrank while the popup was open
  // (a cross-window adopt can swap the active tab underneath it), so every read
  // of it clamps; -1 stays -1, meaning "no active option".
  const active = Math.min(activeIndex, options.length - 1)
  useEffect(() => {
    if (!open) return
    const popup = popupRef.current
    const option = document.getElementById(optionId(baseId, active))
    if (!popup || !option) return
    // Scrolled by hand rather than with scrollIntoView, which also scrolls every
    // ancestor — including the page under a popup that sits near a screen edge.
    // offsetTop is measured from .menu-popup itself (it is position: absolute,
    // so it is the options' offsetParent) and shares scrollTop's origin.
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < popup.scrollTop) popup.scrollTop = top
    else if (bottom > popup.scrollTop + popup.clientHeight) popup.scrollTop = bottom - popup.clientHeight
  }, [open, active, baseId])

  const selectedIndex = options.findIndex((option) => option.value === value)
  const clamp = (index: number) => Math.min(Math.max(index, 0), options.length - 1)
  const resetTypeahead = () => {
    typed.current = { prefix: '', at: 0 }
  }
  const openAt = (index: number) => {
    resetTypeahead()
    setActiveIndex(clamp(index))
    setOpen(true)
  }
  const close = () => {
    resetTypeahead()
    setOpen(false)
    // Focus always lands back on the trigger, whichever way the menu closed —
    // selection, Escape, backdrop click. For Tab this runs *without* stopping
    // the default action, so the browser walks on from the trigger as if the
    // menu had never been open.
    triggerRef.current?.focus({ preventScroll: true })
  }
  const choose = (index: number) => {
    const option = options[index]
    // Closes either way: a marker left pointing past a list that shrank must not
    // leave the menu open swallowing Enter, which reads as a dead key.
    close()
    if (option) onSelect(option.value)
  }
  /**
   * Extends the live prefix by one character and returns where it points, or -1
   * when nothing starts with it. A keystroke that matches nothing is discarded
   * whole — neither the prefix nor its clock moves — so one typo cannot make the
   * rest of the list unreachable, nor hold the buffer alive by refreshing it.
   */
  const typeaheadTarget = (char: string) => {
    if (options.length === 0) return -1
    const now = Date.now()
    const stale = now - typed.current.at > TYPEAHEAD_RESET_MS
    const prefix = (stale ? '' : typed.current.prefix) + char.toLowerCase()
    // A single character steps to the *next* match so repeating it cycles the
    // options sharing an initial; a longer prefix re-tests the active one first.
    const from = prefix.length === 1 ? active + 1 : Math.max(active, 0)
    for (let step = 0; step < options.length; step += 1) {
      const index = (from + step) % options.length
      if (options[index]?.label.toLowerCase().startsWith(prefix)) {
        typed.current = { prefix, at: now }
        return index
      }
    }
    return -1
  }
  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      // Moving the marker abandons the prefix: the next letter starts a fresh
      // search from wherever the arrows left off, not from a dead prefix.
      case 'ArrowDown':
        event.preventDefault()
        resetTypeahead()
        setActiveIndex(clamp(active + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        resetTypeahead()
        setActiveIndex(clamp(active - 1))
        return
      case 'Home':
        event.preventDefault()
        resetTypeahead()
        setActiveIndex(clamp(0))
        return
      case 'End':
        event.preventDefault()
        resetTypeahead()
        setActiveIndex(clamp(options.length - 1))
        return
      case 'Escape':
        event.preventDefault()
        close()
        return
      case 'Tab':
        close()
        return
      case 'Enter':
        event.preventDefault()
        choose(active)
        return
      case ' ': {
        event.preventDefault()
        // Space is a typeahead character only where it continues a live prefix
        // into a multi-word label ("Player two"). Anywhere else — including a
        // prefix it cannot extend — it selects, the way a native select does.
        const target = typeaheadTarget(' ')
        if (target >= 0) setActiveIndex(target)
        else choose(active)
        return
      }
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return
    // Held back from the page, where / would open quick-find.
    event.preventDefault()
    const target = typeaheadTarget(event.key)
    if (target >= 0) setActiveIndex(target)
  }

  return (
    <span className="menu-wrap" ref={wrapRef}>
      {/* What the menu is for, which the trigger's own content never says. A
          hidden node still contributes its text when aria-labelledby points at
          it directly, and naming the trigger by label *and* self keeps the
          current value in the announcement ("Board layout, 4 player layout")
          where a plain aria-label would have replaced it. */}
      <span id={labelId} hidden>{ariaLabel}</span>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-labelledby={`${labelId} ${triggerId}`}
        // Only ever opens: while the menu is open the backdrop paints over the
        // trigger, so every close goes through the backdrop's own close().
        onClick={() => openAt(selectedIndex)}
        onKeyDown={(event) => {
          if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
          // Opening by arrow starts at the end the arrow points from, the way a
          // native select does; Enter/Space open at the current value instead,
          // which the button's own click handling already covers.
          event.preventDefault()
          openAt(event.key === 'ArrowDown' ? 0 : options.length - 1)
        }}
      >
        {children}
        <span className="menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="menu-backdrop"
            // Out of the tab order: the popup below is the menu's one tab stop,
            // so Tab leaves from the trigger rather than into the backdrop.
            tabIndex={-1}
            aria-label={`Close ${ariaLabel} menu`}
            onClick={close}
          />
          <div
            ref={popupRef}
            id={popupId}
            className="menu-popup"
            role="listbox"
            aria-label={ariaLabel}
            // The listbox holds focus itself and points at the active option, so
            // it is one tab stop rather than one per option.
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? optionId(baseId, active) : undefined}
            style={at ?? undefined}
            onKeyDown={onPopupKeyDown}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                id={optionId(baseId, index)}
                type="button"
                role="option"
                // Out of the tab order: the listbox above is the tab stop.
                tabIndex={-1}
                aria-selected={option.value === value}
                // Two independent marks: `active` is the selected value,
                // `keyboard-active` is where the arrows currently sit.
                className={[
                  option.value === value ? 'active' : '',
                  index === active ? 'keyboard-active' : '',
                ].join(' ').trim() || undefined}
                onClick={() => {
                  close()
                  onSelect(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
