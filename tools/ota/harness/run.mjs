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
  evidence, libraryDigest, log, LogWatch, LocalServer, makeKeys, manifestFor, nativeBuild, otaBundle, packBundle, REPO, sim, waitFor,
} from './lib.mjs'

const MAPS_KEY = 'unsettled.maps.v1'
const BUILTIN = '1.0.100'
const BUILD_1 = '20261114.1000'
// Scenario 4's store update: a higher CFBundleVersion and a built-in label above every OTA label before it.
const BUILTIN_2 = '1.0.200'
const BUILD_2 = '20261114.1100'
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
  let ev = evidence(container)
  const recent = () => `status: ${JSON.stringify(ev.status())}\nevents:\n${ev.events().slice(-12).map((e) => JSON.stringify(e)).join('\n')}`
  return {
    get ev() { return ev },
    get container() { return container },
    /** An install over the app moves its data (intact) to a new container path. */
    relocate() {
      container = sim.container()
      ev = evidence(container)
      log(`data container moved to ${container}`)
    },
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
  },

  /**
   * A bundle that throws before ready rolls back to the previous OTA bundle,
   * with and without a kill during its first boot, and is never downloaded
   * again, not even re-encrypted at a new URL; the library survives.
   */
  async 2(h) {
    // A fast good bundle first, so the rollback target and every later launch
    // reach ready well inside the 10 s window (the slow bundle waits 8 s).
    const GOOD = await otaBundle(server, keys, workRoot, '1.0.103')
    const BAD_1 = await otaBundle(server, keys, workRoot, '1.0.104', { VITE_OTA_HARNESS_FAIL: '1' })
    const BAD_2 = await otaBundle(server, keys, workRoot, '1.0.105', { VITE_OTA_HARNESS_FAIL: '1' })
    const COPY = packBundle(server, keys, workRoot, BAD_2.version)
    assert.notEqual(COPY.hash, BAD_2.hash, 're-encrypting gives a different zip')
    h.ev.clearEvents()

    await applyUpdate(h, GOOD)
    log('1.0.103 downloaded, applied and ready')

    // Without a kill: set() at cold start, the bad bundle throws, the plugin rolls back after 10 s.
    server.manifest = manifestFor(BAD_1)
    let at = h.coldStart()
    await h.waitStatus('1.0.103 to download the bad 1.0.104', at, (s) => checked(s) && listed(s, BAD_1.version, 'pending'))
    at = h.coldStart()
    await h.waitEvent('the bad 1.0.104 to boot', (e) => e.at >= at && e.event === 'boot' && e.label === BAD_1.version)
    await waitRollback(h, BAD_1, at)
    let status = await h.waitStatus('1.0.103 running again after the rollback', at, (s) => s.runningLabel === GOOD.version && s.appReady && checked(s))
    assertRolledBack(h, status, GOOD, BAD_1, at)
    log('1.0.104 threw before ready and rolled back to 1.0.103')

    // With a kill 3 s after the bad bundle's first boot: the relaunch runs it again and that launch rolls back.
    server.manifest = manifestFor(BAD_2)
    at = h.coldStart()
    await h.waitStatus('1.0.103 to download the bad 1.0.105', at, (s) => checked(s) && listed(s, BAD_2.version, 'pending'))
    at = h.coldStart()
    const boot = await h.waitEvent('the bad 1.0.105 to boot', (e) => e.at >= at && e.event === 'boot' && e.label === BAD_2.version, 20)
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, boot.at + 3000 - Date.now())))
    sim.terminate()
    assert.deepEqual(logs.pluginLines('roll back current bundle', at), [], 'no rollback before the kill')
    const relaunch = h.coldStart()
    await waitRollback(h, BAD_2, relaunch)
    status = await h.waitStatus('1.0.103 running again after the relaunch rolled back', relaunch, (s) => s.runningLabel === GOOD.version && s.appReady && checked(s))
    assertRolledBack(h, status, GOOD, BAD_2, relaunch)
    assert.ok(h.ev.events().some((e) => e.at >= relaunch && e.event === 'boot' && e.label === BAD_2.version), 'the relaunch booted 1.0.105 again')
    log('killed 1.0.105 3 s into its first boot; the relaunch ran it again and rolled back to 1.0.103')

    // Five more cold starts while the manifest names 1.0.105, the last two at a re-encrypted copy.
    const quiet = Date.now()
    for (let i = 1; i <= 5; i += 1) {
      if (i === 4) server.manifest = manifestFor(COPY)
      at = h.coldStart()
      status = await h.waitStatus(`cold start ${i} of 5 after the rollback`, at, (s) => s.appReady && checked(s))
      assert.equal(status.runningLabel, GOOD.version, `cold start ${i} runs 1.0.103`)
      assert.equal(status.lastDecision.manifest, BAD_2.version, `cold start ${i} read the manifest`)
      assert.equal(status.lastDecision.download, false, `cold start ${i} downloads nothing`)
      assert.ok(listed(status, BAD_1.version, 'error') && listed(status, BAD_2.version, 'error'), `cold start ${i} still lists both failed bundles`)
    }
    const zips = server.requests.filter((r) => r.at >= quiet && (r.url.includes(BAD_2.hash) || r.url.includes(COPY.hash)))
    assert.deepEqual(zips, [], 'no request for either copy of 1.0.105')
    log('five cold starts: 1.0.105 never fetched again, neither copy')

    assert.deepEqual(status.library, shared.firstLibrary ?? libraryDigest(SEED), 'the library after the rollbacks matches the first launch')
    const mirror = JSON.parse(readFileSync(join(h.container, `Library/unsettled/${MAPS_KEY}.json`), 'utf8'))
    const mirrored = new Map(libraryDigest(mirror).map((m) => [m.id, m]))
    for (const seeded of libraryDigest(SEED)) {
      assert.deepEqual(mirrored.get(seeded.id), seeded, `the maps mirror file keeps ${seeded.id} unchanged`)
    }
    log('library intact in localStorage and in the mirror file')
    shared.good = GOOD
  },

  /** With the server stopped the app boots on its current bundle, and a candidate downloaded earlier still applies. */
  async 3(h) {
    const C = await otaBundle(server, keys, workRoot, '1.0.106')
    h.ev.clearEvents()
    const before = await currentStatus(h)

    await server.stop()
    let at = h.coldStart()
    let status = await h.waitStatus('a boot with the server stopped', at, (s) => s.appReady && checked(s))
    assert.equal(status.runningLabel, before.runningLabel, 'boots on its current bundle')
    assert.equal(status.lastDecision.storeNote, 'unchanged', 'no information changes nothing')
    assert.equal(status.lastDecision.download, false)
    log(`server stopped: booted on ${status.runningLabel} and checked without information`)

    await server.start()
    server.manifest = manifestFor(C)
    at = h.coldStart()
    await h.waitStatus('1.0.106 to download', at, (s) => checked(s) && listed(s, C.version, 'pending'))
    await server.stop()
    at = h.coldStart()
    status = await h.waitStatus('1.0.106 applied with the server stopped', at, (s) => s.runningLabel === C.version && s.appReady && checked(s))
    assert.equal(status.lastDecision.manifest, null, 'the check had no information')
    assert.equal(status.current.version, C.version)
    log('server stopped: the downloaded 1.0.106 applied at cold start and reached ready')
    await server.start()
  },

  /** A store update over a pending candidate lands on the new built-in bundle and clears the bundle list. */
  async 4(h) {
    const D = await otaBundle(server, keys, workRoot, '1.0.107')
    h.ev.clearEvents()
    server.manifest = manifestFor(D)
    let at = h.coldStart()
    await h.waitStatus('1.0.107 to download', at, (s) => checked(s) && listed(s, D.version, 'pending'))
    log('1.0.107 downloaded and pending; installing the store update')

    const app = await nativeBuild(server, keys, DERIVED_DATA, { label: BUILTIN_2, build: BUILD_2 })
    sim.terminate()
    sim.install(app)
    h.relocate()
    at = h.coldStart()
    let status = await h.waitStatus('the first launch after the store update', at, (s) => s.appReady && checked(s))
    assert.equal(status.runningLabel, BUILTIN_2, 'runs the new built-in bundle')
    assert.equal(status.builtinLabel, BUILTIN_2)
    assert.equal(status.nativeBuild, BUILD_2)
    assert.equal(status.current.id, 'builtin')
    const launch = h.ev.events().filter((e) => e.at >= at)
    assert.ok(!launch.some((e) => e.event === 'set-called'), 'the pending 1.0.107 was not applied')
    assert.equal(status.lastDecision.download, false)
    log('store update: built-in 1.0.200 running, 1.0.107 not applied')

    at = h.coldStart()
    status = await h.waitStatus('the second launch after the store update', at, (s) => s.appReady && checked(s))
    assert.equal(status.runningLabel, BUILTIN_2)
    assert.deepEqual(status.list, [], 'list() is empty on the second launch after the update')
    log('second launch: list() empty')
    shared.d = D
  },

  /** A newer manifest that needs a newer store build downloads nothing and sets the store note. */
  async 5(h) {
    const bundle = shared.d ?? await otaBundle(server, keys, workRoot, '1.0.107')
    h.ev.clearEvents()
    const before = await currentStatus(h)
    const build = Number(before.nativeBuild.replace('.', ''))
    server.manifest = { ...manifestFor(bundle, build + 100), version: '1.0.201' }
    const at = h.coldStart()
    const status = await h.waitStatus('a check of a manifest above the store build', at, (s) => s.appReady && checked(s))
    assert.equal(status.lastDecision.manifest, '1.0.201')
    assert.equal(status.lastDecision.storeNote, 'set')
    assert.equal(status.lastDecision.download, false)
    assert.equal(status.storeUpdate, true, 'the store note is set')
    assert.ok(!status.list.some((b) => b.version === '1.0.201'))
    assert.deepEqual(server.requests.filter((r) => r.at >= at && r.url.startsWith('/bundles/')), [], 'no bundle requested')
    log(`manifest 1.0.201 needs build ${build + 100}: store note set, nothing downloaded`)
  },
}

/** One launch downloads `bundle`, the next applies it at cold start and reaches ready. */
async function applyUpdate(h, bundle) {
  server.manifest = manifestFor(bundle)
  let at = h.coldStart()
  await h.waitStatus(`${bundle.version} to download`, at, (s) => checked(s) && listed(s, bundle.version, 'pending'))
  at = h.coldStart()
  return h.waitStatus(`${bundle.version} applied and ready`, at, (s) => s.runningLabel === bundle.version && s.appReady && checked(s))
}

/** A fresh status from one launch, for the running state a scenario starts from. */
async function currentStatus(h) {
  const at = h.coldStart()
  return h.waitStatus('the running state', at, (s) => s.appReady && checked(s))
}

/** The plugin's own rollback line naming `bad`, logged after `since`. */
function waitRollback(h, bad, since) {
  return waitFor(`the plugin to roll back ${bad.version}`,
    () => logs.pluginLines('roll back current bundle', since).find(({ line }) => line.includes(`"version": "${bad.version}"`)),
    { describe: h.describe })
}

function assertRolledBack(h, status, good, bad, since) {
  assert.notEqual(status.current.id, 'builtin', 'rolled back to an OTA bundle, not built-in')
  assert.equal(status.current.version, good.version, `rolled back to ${good.version}`)
  assert.ok(listed(status, bad.version, 'error'), `${bad.version} is listed as failed`)
  assert.equal(status.lastDecision.download, false, `the check after the rollback does not fetch ${bad.version} again`)
  const badLoads = new Set(h.ev.events().filter((e) => e.at >= since && e.label === bad.version && e.event === 'boot').map((e) => e.pageLoadId))
  assert.ok(badLoads.size > 0, `${bad.version} booted`)
  assert.ok(!h.ev.events().some((e) => badLoads.has(e.pageLoadId) && e.event !== 'boot'), `${bad.version} never got past boot`)
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

const summary = [`OTA harness summary (${new Date().toISOString()}, run directory ${workRoot})`, ...results].join('\n')
writeFileSync(join(workRoot, 'summary.txt'), `${summary}\n`)
console.log(`\n${summary}`)
process.exit(failed ? 1 : 0)
