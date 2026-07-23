import { useEffect, useRef } from 'react'

interface ConfirmAction {
  label: string
  onClick(): void
  variant?: 'primary' | 'danger'
}

interface Props {
  title: string
  message?: string
  actions: ConfirmAction[]
  onCancel(): void
}

export function ConfirmDialog({ title, message, actions, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      // Trap Tab focus inside the modal so keyboard users can't reach — and
      // mutate — the board behind it (the mousedown backdrop only stops clicks).
      const buttons = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'))
        : []
      if (buttons.length === 0) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const active = document.activeElement
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // Focus the last action (Cancel by convention) so a stray Enter dismisses
    // rather than fires the destructive default; restore focus on close.
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[buttons.length - 1]?.focus()
    return () => previous?.focus?.()
  }, [])

  return (
    <div className="popover-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <div className="confirm-actions">
          {actions.map((action) => (
            <button
              type="button"
              className={action.variant}
              key={action.label}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
