import { useEffect, useState } from 'react'
import { useStore } from './store'

/**
 * The toast, rendered by both shells so a notice reads the same wherever it is
 * raised. Always mounted: it owns the auto-dismiss timer and the
 * `unsettled:notice` window event that code outside React uses to speak.
 */
export function GlobalNotice() {
  const { state, dispatch } = useStore()
  // Pause auto-dismiss while the pointer is over the toast, so it can be read,
  // clicked, and text-selected; the timer restarts fresh once the pointer leaves.
  const [hover, setHover] = useState(false)
  // Keyed on noticeSeq so an identical repeat message still restarts the timer.
  useEffect(() => {
    if (!state.notice || hover) return
    const timeout = window.setTimeout(() => dispatch({ type: 'notice', message: null }), 3500)
    return () => window.clearTimeout(timeout)
  }, [state.notice, state.noticeSeq, hover, dispatch])
  useEffect(() => {
    const showNotice = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      dispatch({ type: 'notice', message: event.detail })
    }
    window.addEventListener('unsettled:notice', showNotice)
    return () => window.removeEventListener('unsettled:notice', showNotice)
  }, [dispatch])
  if (!state.notice) return null
  return (
    <div
      className="global-notice"
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="global-notice-text">{state.notice}</span>
      <button
        type="button"
        className="global-notice-close"
        aria-label="Dismiss notification"
        // Closing unmounts the toast without firing onMouseLeave, so clear the
        // hover flag here or the next notice would never auto-dismiss.
        onClick={() => {
          setHover(false)
          dispatch({ type: 'notice', message: null })
        }}
      >
        ×
      </button>
    </div>
  )
}
