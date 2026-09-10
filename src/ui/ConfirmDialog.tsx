import { ModalDialog } from './ModalDialog'

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
  return (
    <ModalDialog title={title} className="confirm-dialog" onClose={onCancel}>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      <div className="confirm-actions">
        {actions.map((action, index) => (
          <button
            type="button"
            ref={(button) => {

              // React's autoFocus calls focus while the dialog is still hidden.
              if (button) button.autofocus = index === actions.length - 1
            }}
            className={action.variant}
            key={action.label}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </ModalDialog>
  )
}
