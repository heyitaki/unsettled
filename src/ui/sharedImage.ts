import { useSyncExternalStore } from 'react'

export const SHARE_EVENT = 'unsettled:share'

// The one shared image not yet shown, held here because on a cold launch the
// share arrives before React mounts. A newer share replaces an unshown one.
let pending: File | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const snapshot = () => pending
const notify = () => { for (const listener of listeners) listener() }

export function receiveSharedImage(file: File): void {
  pending = file
  notify()
}

/** Removes `file` from the buffer, unless a newer share has replaced it. */
export function takeSharedImage(file: File): void {
  if (pending !== file) return
  pending = null
  notify()
}

export function useSharedImage(): File | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
