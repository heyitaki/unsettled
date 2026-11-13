import { isRecord } from '../model/serialization'
import { lastTouched, mapEntryId, readRawMaps } from './localStorage'

export const CLEANUP_AGE = 30 * 24 * 60 * 60 * 1000
export const CLEANUP_FALLBACK = 5

export interface CleanupCandidate {
  id: string
  name: string
  bytes: number
  lastUsed: number | null
}

export function cleanupCandidates(now: number, open: ReadonlySet<string>): {
  candidates: CleanupCandidate[]
  preselected: string[]
} {
  const candidates: CleanupCandidate[] = []
  readRawMaps().entries.forEach((entry, index) => {
    const id = mapEntryId(entry)
    if (id === null || open.has(id) || !isRecord(entry)) return
    const touched = lastTouched(entry)
    candidates.push({
      id,
      name: typeof entry.name === 'string' ? entry.name : `Invalid map ${index + 1}`,
      bytes: JSON.stringify(entry).length,
      lastUsed: touched === -Infinity ? null : touched,
    })
  })
  candidates.sort((left, right) => (left.lastUsed ?? -Infinity) - (right.lastUsed ?? -Infinity))
  const old = candidates.filter(({ lastUsed }) => lastUsed === null || now - lastUsed >= CLEANUP_AGE)
  const preselected = (old.length > 0 ? old : candidates.slice(0, CLEANUP_FALLBACK)).map(({ id }) => id)
  return { candidates, preselected }
}
