import { App } from '@capacitor/app'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { checkOutcome, chooseCandidate, parseManifest, parseNativeBuild, runningLabel } from './otaDecisions'
import { updateOtaStatus } from './otaStatus'

// Thin adapter between the updater plugin and the pure rules in otaDecisions.
// Updates apply only at cold start; this module never calls next(), reload(),
// reset() or delete(), and every list() is the default form, which lists bundle
// folders on disk (the raw registry keeps records that would block a retry).

// Harness builds only (VITE_OTA_HARNESS=1); every other build folds this to
// null and drops the module.
const harness = import.meta.env.VITE_OTA_HARNESS === '1' ? import('./otaHarness') : null

async function trace(event: string, detail?: Record<string, unknown>): Promise<void> {
  if (harness) await (await harness).record(event, detail)
}

const seeded = async () => harness !== null && (await harness).seeded

const DEFAULT_MANIFEST_URL = 'https://akshath.me/unsettled-ota/ios.json'
const MANIFEST_TIMEOUT_MS = 5000

async function running() {
  const [{ bundle }, { version: builtin }] = await Promise.all([CapacitorUpdater.current(), CapacitorUpdater.getBuiltinVersion()])
  const label = runningLabel(bundle, builtin)
  updateOtaStatus({ bundleVersion: label })
  return { currentId: bundle.id, label, builtin }
}

/**
 * Before React mounts: switch to the newest downloaded, never-run bundle.
 * `set()` reloads the WebView before it resolves, so after it this never
 * settles and the page is replaced without mounting or calling
 * notifyAppReady(). A rejection lets the caller mount on the current bundle.
 */
export async function applyAtColdStart(): Promise<void> {
  if (await seeded()) return
  const { currentId, label, builtin } = await running()
  const { bundles } = await CapacitorUpdater.list()
  const candidate = chooseCandidate(bundles, currentId, label, builtin)
  await trace('cold-start', candidate ? { decision: 'set', id: candidate.id, version: candidate.version } : { decision: 'none' })
  if (!candidate) return
  await trace('set-called', { id: candidate.id, version: candidate.version })
  await CapacitorUpdater.set({ id: candidate.id })
  await new Promise<never>(() => {})
}

async function fetchManifestBody(): Promise<string | null> {
  const url = new URL(import.meta.env.VITE_OTA_MANIFEST_URL || DEFAULT_MANIFEST_URL)
  // Pages serves max-age=600 behind Cloudflare, so the query and no-store dodge both caches.
  url.searchParams.set('t', String(Date.now()))
  // AbortSignal.timeout needs iOS 16 and the deployment target is 15.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    return response.ok ? await response.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** One manifest check: updates the store note and downloads when the rules say so. */
export async function checkForUpdate(): Promise<void> {
  const body = await fetchManifestBody()
  const manifest = body === null ? null : parseManifest(body, import.meta.env.VITE_OTA_HARNESS === '1')
  const [{ label, builtin }, { bundles }, { build }] = await Promise.all([running(), CapacitorUpdater.list(), App.getInfo()])
  const outcome = checkOutcome(manifest, label, builtin, parseNativeBuild(build), bundles)
  if (outcome.storeNote !== 'unchanged') updateOtaStatus({ storeUpdate: outcome.storeNote === 'set' })
  if (outcome.download && manifest) {
    const { url, version, checksum, sessionKey } = manifest
    await CapacitorUpdater.download({ url, version, checksum, sessionKey })
  }
  await trace('check-done', { manifest: manifest?.version ?? null, ...outcome })
}

let started = false
let checking = false

// Single flight: a check asked for while one runs is dropped, never queued.
function runCheck(): void {
  if (checking) return
  checking = true
  void checkForUpdate()
    .catch((error: unknown) => {
      console.warn('Update check failed', error)
      return trace('check-done', { error: String(error) })
    })
    .finally(() => { checking = false })
}

/**
 * After the first commit of StoreProvider, once per page load: tell the
 * plugin this bundle booted, then check now and on every later resume. The
 * resume listener is added only as the first check starts, so a resume before
 * then is dropped.
 */
export async function startUpdates(): Promise<void> {
  if (started) return
  started = true
  if (await seeded()) return
  await trace('mounted')
  if (harness) await (await harness).beforeReady()
  await CapacitorUpdater.notifyAppReady()
  await trace('ready')
  runCheck()
  await App.addListener('resume', runCheck)
}
