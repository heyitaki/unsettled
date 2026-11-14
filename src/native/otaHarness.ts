import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { isRecord } from '../model/serialization'
import { MAPS_KEY } from '../persistence/localStorage'
import { runningLabel } from './otaDecisions'
import { getOtaStatus, updateOtaStatus, type OtaStatus } from './otaStatus'

// Evidence for the simulator harness (tools/ota/harness/). Only builds made
// with VITE_OTA_HARNESS=1 load this module; every other build folds the
// import away, so no code that writes Library/ota-harness ships to a phone.
// status.json is rewritten after every event with this page load's id, and
// events.jsonl gets one line per event; the harness deletes the first before
// each launch and clears the second per scenario.

const DIR = 'ota-harness'
const pageLoadId = crypto.randomUUID()

/**
 * True in a native-mode harness build running in a browser (the Playwright
 * screenshot fallback): the status comes from VITE_OTA_HARNESS_STATUS and the
 * updater is never driven, since its web stub would overwrite that status.
 */
export const seeded = !Capacitor.isNativePlatform() && Boolean(import.meta.env.VITE_OTA_HARNESS_STATUS)
if (seeded) updateOtaStatus(JSON.parse(import.meta.env.VITE_OTA_HARNESS_STATUS as string) as Partial<OtaStatus>)

const TIMESTAMP_FIELDS = new Set(['createdAt', 'modifiedAt', 'openedAt'])

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Each stored map's id, name and the SHA-256 of `JSON.stringify` of its entry
 * without the timestamp fields, keys in stored order. The harness hashes its
 * seed the same way. Null when the key is missing or not a JSON array.
 */
export async function libraryDigest(raw: string | null): Promise<{ id: unknown; name: unknown; hash: string }[] | null> {
  if (raw === null) return null
  let entries: unknown
  try {
    entries = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(entries)) return null
  return Promise.all(entries.map(async (entry: unknown) => {
    if (!isRecord(entry)) return { id: null, name: null, hash: await sha256(JSON.stringify(entry)) }
    const kept = Object.fromEntries(Object.entries(entry).filter(([key]) => !TIMESTAMP_FIELDS.has(key)))
    return { id: kept.id ?? null, name: kept.name ?? null, hash: await sha256(JSON.stringify(kept)) }
  }))
}

let labels: Promise<{ running: string; builtin: string }> | null = null
const readLabels = () => labels ??= Promise.all([CapacitorUpdater.current(), CapacitorUpdater.getBuiltinVersion()])
  .then(([{ bundle }, { version }]) => ({ running: runningLabel(bundle, version), builtin: version }))

// appendFile cannot create the directory, so make it once per page load.
let dir: Promise<unknown> | null = null
const ensureDir = () => dir ??= Filesystem.mkdir({ path: DIR, directory: Directory.Library, recursive: true }).catch(() => {})

let lastDecision: Record<string, unknown> | null = null
let appReady = false
let library: Awaited<ReturnType<typeof libraryDigest>> = null
let queue: Promise<void> = Promise.resolve()

async function write(event: string, detail: Record<string, unknown>): Promise<void> {
  const { running, builtin } = await readLabels()
  const at = Date.now()
  if (event === 'mounted') library = await libraryDigest(localStorage.getItem(MAPS_KEY))
  if (event === 'ready') appReady = true
  if (event !== 'boot' && event !== 'mounted' && event !== 'ready-called') lastDecision = { event, ...detail }
  await ensureDir()
  await Filesystem.appendFile({
    path: `${DIR}/events.jsonl`,
    data: `${JSON.stringify({ pageLoadId, label: running, at, event, ...detail })}\n`,
    directory: Directory.Library,
    encoding: Encoding.UTF8,
  })
  const [{ bundle }, { bundles }, raw, { build }] = await Promise.all([
    CapacitorUpdater.current(),
    CapacitorUpdater.list(),
    // Diagnostics only (spec Requirement 7): the boot module never reads the raw registry.
    CapacitorUpdater.list({ raw: true }),
    App.getInfo(),
  ])
  const status = {
    pageLoadId,
    writtenAt: Date.now(),
    runningLabel: running,
    builtinLabel: builtin,
    nativeBuild: build,
    current: bundle,
    list: bundles,
    rawList: raw.bundles,
    lastDecision,
    appReady,
    ...getOtaStatus(),
    library,
  }
  await Filesystem.writeFile({
    path: `${DIR}/status.json`,
    data: JSON.stringify(status, null, 2),
    directory: Directory.Library,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

/**
 * Appends one event and rewrites status.json, in call order. Resolves once
 * both are written; a failure is logged and never breaks the boot.
 */
export function record(event: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (seeded) return Promise.resolve()
  queue = queue.then(() => write(event, detail)).catch((error: unknown) => console.error('ota-harness write failed', error))
  return queue
}

/** The slow bundle's wait (VITE_OTA_HARNESS_READY_DELAY_MS), then the awaited `ready-called` line. */
export async function beforeReady(): Promise<void> {
  const delay = Number(import.meta.env.VITE_OTA_HARNESS_READY_DELAY_MS ?? 0)
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  await record('ready-called')
}
