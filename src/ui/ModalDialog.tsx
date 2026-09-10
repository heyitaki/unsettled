import type { KeyboardEvent, ReactNode } from 'react'

function openModal(dialog: HTMLDialogElement) {
  dialog.showModal()
  return () => dialog.close()
}

// showModal() makes the page inert and restores the opener on close, but Tab past either end
// still leaves for the browser chrome, so only the wrap-around is ours.
function wrapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex="0"]',
  )).filter((element) => !element.matches(':disabled') && !element.closest('[hidden], [inert]'))
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last) return
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
}

export function ModalDialog({ title, className, onClose, children }: {
  title: string
  className: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <dialog
      ref={openModal}
      className="modal-dialog"
      aria-label={title}
      onCancel={onClose}
      onKeyDown={wrapTab}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={className}>{children}</div>
    </dialog>
  )
}
