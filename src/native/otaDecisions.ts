// Pure OTA update decisions. No Capacitor import, so every rule is testable
// without the plugin; the adapter feeds these plain data from the plugin.

/** The subset of the plugin's BundleInfo the decisions read. */
export interface BundleEntry {
  id: string
  version: string
  status: string
}

export interface Manifest {
  schema: 1
  version: string
  url: string
  checksum: string
  sessionKey: string
  minNativeBuild: number
}

export interface CheckOutcome {
  storeNote: 'set' | 'clear' | 'unchanged'
  download: boolean
}

const LABEL = /^\d+\.\d+\.\d+$/

export function parseLabel(label: string): [number, number, number] | null {
  if (!LABEL.test(label)) return null
  const parts = label.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? (parts as [number, number, number]) : null
}

/** True when `a` is a valid label above `b`. An invalid `a` is never newer; any valid label is newer than an invalid `b`. */
export function isNewer(a: string, b: string): boolean {
  const x = parseLabel(a)
  if (!x) return false
  const y = parseLabel(b)
  if (!y) return true
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** `CFBundleVersion` as one integer: `20261113.1956` becomes `202611131956`. Null when unparseable. */
export function parseNativeBuild(build: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(build)) return null
  const n = Number(build.replace('.', ''))
  return Number.isSafeInteger(n) ? n : null
}

const MANIFEST_KEYS = ['schema', 'version', 'url', 'checksum', 'sessionKey', 'minNativeBuild']

function allowedUrl(url: string, harness: boolean): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return parsed.hostname !== ''
  // Harness builds fetch bundles from a plain-HTTP loopback server; production never does.
  return harness && parsed.protocol === 'http:' && parsed.port !== '' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
}

/** The manifest body if it is exactly the published shape, else null (no information). */
export function parseManifest(body: string, harness: boolean): Manifest | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== MANIFEST_KEYS.length || !MANIFEST_KEYS.every((k) => keys.includes(k))) return null
  const m = value as Record<string, unknown>
  if (m.schema !== 1) return null
  if (typeof m.version !== 'string' || !LABEL.test(m.version)) return null
  if (typeof m.url !== 'string' || !allowedUrl(m.url, harness)) return null
  if (typeof m.checksum !== 'string' || m.checksum === '') return null
  if (typeof m.sessionKey !== 'string' || m.sessionKey === '') return null
  if (typeof m.minNativeBuild !== 'number' || !Number.isSafeInteger(m.minNativeBuild) || m.minNativeBuild < 0) return null
  return m as unknown as Manifest
}

/** The label of the bundle running now: the built-in label when the plugin reports `builtin`. */
export function runningLabel(current: { id: string; version: string }, builtinLabel: string): string {
  return current.id === 'builtin' ? builtinLabel : current.version
}

/**
 * The downloaded, never-run bundle to apply at cold start: a `pending` entry
 * that is not current and is newer than both the running and built-in labels,
 * the newest of them. Null when none qualifies.
 */
export function chooseCandidate(bundles: readonly BundleEntry[], currentId: string, running: string, builtinLabel: string): BundleEntry | null {
  let best: BundleEntry | null = null
  for (const b of bundles) {
    if (b.status !== 'pending' || b.id === currentId) continue
    if (!isNewer(b.version, running) || !isNewer(b.version, builtinLabel)) continue
    if (!best || isNewer(b.version, best.version)) best = b
  }
  return best
}

// A version in one of these statuses was downloaded already, failed or not,
// and is never downloaded again. `downloading` and `deleting` are leftovers of
// a killed process that the plugin resumes or sweeps, so they do not block.
const SEEN = new Set(['pending', 'success', 'error'])

/** What a manifest check does to the store note and whether it downloads. `manifest` null means no information. */
export function checkOutcome(
  manifest: Manifest | null,
  running: string,
  builtinLabel: string,
  nativeBuild: number | null,
  bundles: readonly BundleEntry[],
): CheckOutcome {
  if (!manifest) return { storeNote: 'unchanged', download: false }
  if (!isNewer(manifest.version, running) || !isNewer(manifest.version, builtinLabel)) return { storeNote: 'clear', download: false }
  if (nativeBuild === null) return { storeNote: 'clear', download: false }
  if (manifest.minNativeBuild > nativeBuild) return { storeNote: 'set', download: false }
  const seen = bundles.some((b) => b.version === manifest.version && SEEN.has(b.status))
  return { storeNote: 'clear', download: !seen }
}
