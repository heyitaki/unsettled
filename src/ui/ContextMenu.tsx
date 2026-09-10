import { useLayoutEffect, useRef, type ReactNode } from 'react'

export interface ContextMenuItem {
  label: string
  onClick(): void
  /** A glyph before the label. */
  icon?: ReactNode
  disabled?: boolean
  /** Styled as destructive, for the actions that throw board work away. */
  danger?: boolean
}

const enabledItems = (menu: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])

type FocusStep = 1 | -1 | 'first' | 'last'

const FOCUS_KEYS: Record<string, FocusStep> = {
  ArrowDown: 1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
}

/** An anchored sheet with native light-dismiss and arrow-key menu navigation. */
export function ContextMenu({ ariaLabel, trigger, items, history, className, onClose }: {
  ariaLabel: string
  trigger: HTMLButtonElement
  items: readonly ContextMenuItem[]
  history?: readonly ContextMenuItem[]
  className?: string
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    menu.showPopover({ source: trigger })
    enabledItems(menu)[0]?.focus({ preventScroll: true })
    return () => menu.hidePopover()
  }, [trigger])

  const close = () => {
    menuRef.current?.hidePopover()
    onClose()
  }
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
  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={item.danger ? 'danger' : undefined}
      disabled={item.disabled}
      onClick={() => {
        close()
        item.onClick()
      }}
    >
      {item.icon !== undefined && <span className="menu-icon" aria-hidden="true">{item.icon}</span>}
      <span>{item.label}</span>
    </button>
  )
  return (
    <div
      ref={menuRef}
      popover="auto"
      className={className ? `menu-popup sheet-menu ${className}` : 'menu-popup sheet-menu'}
      role="menu"
      aria-label={ariaLabel}
      onToggle={(event) => {
        if (event.newState === 'closed') onClose()
      }}
      onKeyDown={(event) => {
        const step: FocusStep | undefined = FOCUS_KEYS[event.key]
        if (step !== undefined) {
          event.preventDefault()
          moveFocus(step)
          return
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          close()
        }
      }}
    >
      <span className="menu-tail" aria-hidden="true" />
      {history && <div className="menu-history">{history.map(renderItem)}</div>}
      {items.map(renderItem)}
    </div>
  )
}
