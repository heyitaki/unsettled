import { useSyncExternalStore } from 'react'

// What the Maps version line shows. In memory only and free of any plugin
// import, so the website build can read it too; `storeUpdate` starts false on
// every page load and only a check sets it.
export interface OtaStatus {
  bundleVersion: string | null
  storeUpdate: boolean
}

let status: OtaStatus = { bundleVersion: null, storeUpdate: false }
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getOtaStatus(): OtaStatus {
  return status
}

export function updateOtaStatus(change: Partial<OtaStatus>): void {
  const next = { ...status, ...change }
  if (next.bundleVersion === status.bundleVersion && next.storeUpdate === status.storeUpdate) return
  status = next
  for (const listener of listeners) listener()
}

export function useOtaStatus(): OtaStatus {
  return useSyncExternalStore(subscribe, getOtaStatus, getOtaStatus)
}
