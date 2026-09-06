import { useEffect, useRef } from 'react'

export function useDialogFocus(onClose: () => void, focusLast = false) {
  const ref = useRef<HTMLDivElement>(null)
  const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('*') ?? [])
    .filter((element) => element.matches('button, input, select, textarea, a[href], [tabindex="0"]')
      && !element.matches(':disabled') && !element.closest('[hidden], [inert]'))
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const items = controls()
    const target = (focusLast ? items.at(-1) : items[0]) ?? ref.current
    target?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [focusLast])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) {
        event.preventDefault()
        ref.current?.focus()
      } else if (!ref.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return ref
}
