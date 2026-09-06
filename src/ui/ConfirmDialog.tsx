import { useDialogFocus } from './useDialogFocus'

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
  const dialogRef = useDialogFocus(onCancel, true)

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
