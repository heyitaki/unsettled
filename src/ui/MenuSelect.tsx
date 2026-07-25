import { useState, type ReactNode } from 'react'

/**
 * The shared popup-listbox dropdown: a transparent trigger showing the current
 * value, a fixed full-screen backdrop that closes on any outside click, and an
 * absolutely-positioned option menu. Used by the board header's layout picker
 * and the analysis panel's "You are …" selector so both look identical.
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
  return (
    <span className="menu-wrap">
      <button
        type="button"
        className="menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {children}
        <span className="menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="menu-backdrop"
            aria-label={`Close ${ariaLabel} menu`}
            onClick={() => setOpen(false)}
          />
          <div className="menu-popup" role="listbox" aria-label={ariaLabel}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? 'active' : undefined}
                onClick={() => {
                  setOpen(false)
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
