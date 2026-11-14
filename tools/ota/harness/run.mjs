// OTA end-to-end proof on the booted iOS simulator (spec Requirement 13):
//   npm run ota:harness [-- --only 1,2]
// Wipes the simulator's Unsettled data. Prints one PASS or FAIL line per
// scenario and for the run-wide log check, and exits nonzero on any failure.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  evidence, libraryDigest, log, LogWatch, LocalServer, makeKeys, manifestFor, nativeBuild, otaBundle, REPO, sim, waitFor,
} from './lib.mjs'

const MAPS_KEY = 'unsettled.maps.v1'
const BUILTIN = '1.0.100'
const BUILD_1 = '20261114.1000'
// Reused across runs: an incremental Debug build takes a fraction of a clean one.
const DERIVED_DATA = join(tmpdir(), 'unsettled-ota-harness-derived-data')

const { values } = parseArgs({ options: { only: { type: 'string' } } })
const only = values.only ? new Set(values.only.split(',')) : null

const workRoot = mkdtempSync(join(tmpdir(), 'unsettled-ota-harness-'))
log(`run directory ${workRoot}`)
const keys = makeKeys(join(workRoot, 'keys'))
const serveDir = join(workRoot, 'serve')
mkdirSync(serveDir)
const server = new LocalServer(serveDir, join(workRoot, 'server.log'))
const logs = new LogWatch(join(workRoot, 'log-stream.txt'), '127.0.0.1')

// Two maps on the fixture board, so the restore and rollback checks compare real entries.
const board = JSON.parse(readFileSync(join(REPO, 'src/parser/__tests__/expected/board-draft-empty.json'), 'utf8'))
const SEED = [
  { id: 'harness-map-1', name: 'Harness one', game: { schemaVersion: 1, board, stats: {} }, createdAt: 1, modifiedAt: 2 },
  { id: 'harness-map-2', name: 'Harness two', game: { schemaVersion: 1, board, stats: {} }, createdAt: 3, modifiedAt: 4 },
]

/** What every scenario drives: the evidence files, launches and status waits. */
function harness(container) {
  const ev = evidence(container)
  const recent = () => `status: ${JSON.stringify(ev.status())}\nevents:\n${ev.events().slice(-12).map((e) => JSON.stringify(e)).join('\n')}`
  return {
    ev,
    container,
    /** Terminate, delete status.json, launch; returns the launch's start time. */
    coldStart() {
      sim.terminate()
      ev.clearStatus()
      const at = Date.now()
      sim.launch()
      return at
    },
    /** A status written after `since` that satisfies `test(status, events)`. */
    waitStatus(what, since, test) {
      return waitFor(what, () => {
        const status = ev.status()
        return status && status.writtenAt >= since && test(status, ev.events()) ? status : null
      }, { describe: recent })
    },
    waitEvent(what, test, interval = 200) {
      return waitFor(what, () => ev.events().find(test), { interval, describe: recent })
    },
    describe: recent,
  }
}

const listed = (status, version, state) => status.list.some((b) => b.version === version && b.status === state)
const checked = (status) => status.lastDecision?.event === 'check-done'

/**
 * Seeds the library through the mirror files, which bootNative restores. A
 * container that does not exist yet is made by one launch, after which the
 * WebView's storage is deleted so the restore runs.
 */
async function seedLibrary() {
  let container = sim.container()
  if (!container || !existsSync(join(container, 'Library'))) {
    log('no data container yet: launching once to create it')
    server.manifest = null
    sim.launch()
    container = await waitFor('the data container', () => sim.container())
    await waitFor('the first page load', () => evidence(container).status())
    sim.terminate()
    rmSync(join(container, 'Library/WebKit'), { recursive: true, force: true })
  }
  const dir = join(container, 'Library/unsettled')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${MAPS_KEY}.json`), JSON.stringify(SEED))
  return container
}

const shared = {}

const scenarios = {
  /** An update downloads on one run and applies on the next cold start; then an interrupted apply. */
  async 1(h) {
    const A = await otaBundle(server, keys, workRoot, '1.0.101')
    const SLOW = await otaBundle(server, keys, workRoot, '1.0.102', { VITE_OTA_HARNESS_READY_DELAY_MS: '8000' })
    h.ev.clearEvents()

    server.manifest = manifestFor(A)
    let at = h.coldStart()
    let status = await h.waitStatus('the built-in bundle to download 1.0.101', at, (s) => checked(s) && listed(s, A.version, 'pending'))
    assert.equal(status.runningLabel, BUILTIN, 'first launch runs the built-in bundle')
    assert.equal(status.builtinLabel, BUILTIN, 'getBuiltinVersion() returns the configured label')
    assert.equal(status.nativeBuild, BUILD_1, 'native build is CFBundleVersion')
    assert.equal(status.lastDecision.download, true)
    assert.deepEqual(status.library, libraryDigest(SEED), 'first launch restored the seeded library')
    shared.firstLibrary = status.library
    log('launch 1: built-in running, 1.0.101 downloaded and pending')

    at = h.coldStart()
    status = await h.waitStatus('1.0.101 running and ready', at, (s) => s.runningLabel === A.version && s.appReady && checked(s))
    const launch2 = h.ev.events().filter((e) => e.at >= at)
    const setCalled = launch2.find((e) => e.event === 'set-called')
    assert.equal(setCalled?.version, A.version, 'the cold start set() 1.0.101')
    assert.equal(setCalled.label, BUILTIN, 'set() came from the built-in page load')
    assert.ok(!launch2.some((e) => e.pageLoadId === setCalled.pageLoadId && e.event === 'mounted'), 'the page that called set() never mounted')
    assert.ok(launch2.some((e) => e.label === A.version && e.event === 'boot' && e.pageLoadId !== setCalled.pageLoadId), '1.0.101 booted in a new page load')
    assert.equal(status.current.version, A.version)
    assert.equal(status.lastDecision.download, false, 'a manifest naming the running version downloads nothing')
    log('launch 2: 1.0.101 applied at cold start and ready')

    server.manifest = manifestFor(SLOW)
    at = h.coldStart()
    status = await h.waitStatus('1.0.101 to download the slow 1.0.102', at, (s) => checked(s) && listed(s, SLOW.version, 'pending'))
    assert.equal(status.runningLabel, A.version)
    log('launch 3: slow 1.0.102 downloaded and pending')

    at = h.coldStart()
    const boot = await h.waitEvent('the slow bundle to boot', (e) => e.at >= at && e.event === 'boot' && e.label === SLOW.version, 20)
    sim.terminate()
    const killed = h.ev.events().filter((e) => e.pageLoadId === boot.pageLoadId)
    assert.ok(!killed.some((e) => e.event === 'ready-called'), 'the interrupted page load never reached ready-called')
    log(`launch 4: killed the slow bundle's first page load (${killed.map((e) => e.event).join(', ')})`)

    const relaunch = h.coldStart()
    status = await h.waitStatus('the slow bundle running and ready after the relaunch', relaunch, (s) => s.runningLabel === SLOW.version && s.appReady)
    const ready = h.ev.events().find((e) => e.at >= relaunch && e.event === 'ready' && e.label === SLOW.version)
    assert.ok(ready && ready.pageLoadId !== boot.pageLoadId, 'a later page load of the slow bundle reached ready')
    assert.equal(status.current.version, SLOW.version)
    assert.deepEqual(logs.pluginLines('roll back current bundle', at), [], 'no rollback during the interrupted apply')
    log('launch 5: slow 1.0.102 ran again with a fresh window and reached ready')
    shared.lastGood = SLOW
  },
}

const results = []
let failed = false
try {
  await server.start()
  await logs.start()
  log(`server ${server.origin}, log stream running`)
  const app = await nativeBuild(server, keys, DERIVED_DATA, { label: BUILTIN, build: BUILD_1 })
  sim.terminate()
  sim.uninstall()
  sim.install(app)
  const container = await seedLibrary()
  log(`data container ${container}`)
  const h = harness(container)
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (only && !only.has(name)) continue
    log(`scenario ${name}`)
    try {
      await scenario(h)
      results.push(`PASS scenario ${name}`)
    } catch (error) {
      failed = true
      results.push(`FAIL scenario ${name}: ${error.message}`)
      console.error(error)
      break
    }
  }
  // Run-wide: no Capgo host anywhere, and the local host at least once as a positive control.
  const capgo = logs.capgo.length
  const control = logs.control.length
  const logOk = capgo === 0 && control > 0
  failed ||= !logOk
  results.push(`${logOk ? 'PASS' : 'FAIL'} log check: ${capgo} lines naming capgo.app or capgo.io, ${control} lines naming 127.0.0.1`)
} catch (error) {
  failed = true
  results.push(`FAIL setup: ${error.message}`)
  console.error(error)
} finally {
  sim.terminate()
  logs.stop()
  await server.stop()
  rmSync(join(workRoot, 'keys'), { recursive: true, force: true })
}

console.log(`\nOTA harness summary (${new Date().toISOString()}, run directory ${workRoot})`)
for (const line of results) console.log(line)
process.exit(failed ? 1 : 0)
