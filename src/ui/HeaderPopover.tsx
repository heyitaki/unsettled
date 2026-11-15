import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** An anchored panel with native light dismiss and focus restoration. */
export function HeaderPopover({ label, className, trigger, onClose, children }: {
  label: string
  className: string
  trigger: HTMLButtonElement
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const popup = ref.current
    if (!popup) return
    popup.showPopover({ source: trigger })
    popup.focus({ preventScroll: true })
    return () => popup.hidePopover()
  }, [trigger])
  return (
    <div
      ref={ref}
      popover="auto"
      className={`head-popover ${className}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onToggle={(event) => {
        // A nested menu's toggle event bubbles here, but must not close this panel.
        if (event.target !== event.currentTarget || event.newState !== 'closed') return
        onClose()
      }}
    >
      {children}
    </div>
  )
}
