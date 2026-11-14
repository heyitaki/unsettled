// Building blocks for the OTA simulator harness (run.mjs): the loopback
// server, the whole-run log stream, simulator and container access, the
// harness builds and polling waits.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { capgoPack, cleanEnv } from '../publish.mjs'

export const REPO = fileURLToPath(new URL('../../../', import.meta.url))
export const APP_ID = 'me.akshath.unsettled'
const BIN = join(REPO, 'node_modules/.bin')
const STEP_TIMEOUT_MS = 60_000

export const log = (...parts) => console.log(`[harness ${new Date().toISOString().slice(11, 19)}]`, ...parts)
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** Runs a command with its output streamed, printing a heartbeat so a long build is never silent. */
export function run(cmd, args, { env = cleanEnv(), cwd = REPO } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' })
    const beat = setInterval(() => log(`still running ${cmd} ${args[0] ?? ''} (${Math.round((Date.now() - started) / 1000)} s)`), 30_000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearInterval(beat)
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

/** Polls `probe` until it returns a truthy value; fails after 60 s with `describe()`'s last state. */
export async function waitFor(what, probe, { interval = 200, describe } = {}) {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${STEP_TIMEOUT_MS / 1000} s waiting for ${what}${describe ? `\n${describe()}` : ''}`)
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

/** Throwaway bundle key pair for this run, PKCS#1 as the plugin and the config require. */
export function makeKeys(dir) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  mkdirSync(dir, { recursive: true })
  const pub = join(dir, 'bundle.pub')
  const key = join(dir, 'bundle.key')
  writeFileSync(pub, publicKey)
  writeFileSync(key, privateKey, { mode: 0o600 })
  return { pub, key }
}

/**
 * Static server on loopback: `/ios.json` serves the current manifest (404 while
 * it is null), `/bundles/<file>` serves from `dir`. Every request is logged and
 * every response carries `Access-Control-Allow-Origin: *`. `stop()` and
 * `start()` keep the port, which the harness builds bake in.
 */
export class LocalServer {
  constructor(dir, logFile) {
    this.dir = dir
    this.logFile = logFile
    this.manifest = null
    this.requests = []
    this.port = 0
    this.server = null
  }

  async start() {
    this.server = createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname
      let status = 404
      let body = 'not found'
      let type = 'text/plain'
      if (path === '/ios.json' && this.manifest) {
        status = 200
        body = JSON.stringify(this.manifest)
        type = 'application/json'
      } else if (path.startsWith('/bundles/') && /^[\w.-]+$/.test(path.slice(9)) && existsSync(join(this.dir, path.slice(9)))) {
        status = 200
        body = readFileSync(join(this.dir, path.slice(9)))
        type = 'application/zip'
      }
      const entry = { at: Date.now(), method: req.method, url: req.url, status }
      this.requests.push(entry)
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`)
      res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
      res.end(body)
    })
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', resolve)
    })
    this.port = this.server.address().port
  }

  async stop() {
    if (!this.server) return
    this.server.closeAllConnections()
    await new Promise((resolve) => this.server.close(resolve))
    this.server = null
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`
  }

  /** Copies an encrypted zip in under `<name>` and returns its URL. */
  publish(file, name) {
    copyFileSync(file, join(this.dir, name))
    return `${this.origin}/bundles/${name}`
  }
}

// `log stream --style compact` lines start with a local timestamp.
const lineTime = (line) => {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3})/.exec(line)
  return m ? new Date(`${m[1]}T${m[2]}`).getTime() : Date.now()
}

/**
 * The whole-run `log stream`: every line is scanned for the Capgo hosts and
 * the local server's host; the plugin's own lines (and both kinds of match)
 * are kept with their timestamps and copied to `file`.
 */
export class LogWatch {
  constructor(file, host) {
    this.file = file
    this.host = host
    this.capgo = []
    this.control = []
    this.plugin = []
  }

  async start() {
    this.child = spawn('xcrun', ['simctl', 'spawn', 'booted', 'log', 'stream', '--level', 'debug', '--style', 'compact'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const lines = createInterface({ input: this.child.stdout })
    let started = false
    lines.on('line', (line) => {
      started = true
      const kept = { at: lineTime(line), line }
      let keep = false
      if (/capgo\.(app|io)/i.test(line)) { this.capgo.push(kept); keep = true }
      if (line.includes(this.host)) { this.control.push(kept); keep = true }
      if (line.includes('CapgoUpdater')) { this.plugin.push(kept); keep = true }
      if (keep) appendFileSync(this.file, `${line}\n`)
    })
    await waitFor('the log stream to start', () => started)
  }

  stop() {
    this.child?.kill()
  }

  /** Plugin lines containing `text`, logged at or after `since`. */
  pluginLines(text, since) {
    return this.plugin.filter(({ at, line }) => at >= since && line.includes(text))
  }
}

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** The booted simulator's copy of the app: install, launches and the data container. */
export const sim = {
  container() {
    try {
      return simctl('get_app_container', 'booted', APP_ID, 'data')
    } catch {
      return null
    }
  },
  uninstall() {
    try {
      simctl('uninstall', 'booted', APP_ID)
    } catch {
      // Not installed.
    }
  },
  install(app) {
    simctl('install', 'booted', app)
  },
  launch() {
    simctl('launch', 'booted', APP_ID)
  },
  terminate() {
    try {
      simctl('terminate', 'booted', APP_ID)
    } catch {
      // Not running.
    }
  },
}

/** Harness evidence files in the data container (written by src/native/otaHarness.ts). */
export function evidence(container) {
  const dir = join(container, 'Library/ota-harness')
  const statusFile = join(dir, 'status.json')
  const eventsFile = join(dir, 'events.jsonl')
  return {
    status() {
      try {
        return JSON.parse(readFileSync(statusFile, 'utf8'))
      } catch {
        // Missing, or caught mid-write.
        return null
      }
    },
    events() {
      if (!existsSync(eventsFile)) return []
      return readFileSync(eventsFile, 'utf8').split('\n').flatMap((line) => {
        try {
          return line ? [JSON.parse(line)] : []
        } catch {
          return []
        }
      })
    },
    clearStatus() {
      rmSync(statusFile, { force: true })
    },
    clearEvents() {
      rmSync(eventsFile, { force: true })
    },
  }
}

/** Same digest as `libraryDigest` in src/native/otaHarness.ts: entry minus timestamps, keys in stored order. */
export function libraryDigest(entries) {
  const TIMESTAMPS = new Set(['createdAt', 'modifiedAt', 'openedAt'])
  return entries.map((entry) => {
    const kept = Object.fromEntries(Object.entries(entry).filter(([key]) => !TIMESTAMPS.has(key)))
    return { id: kept.id ?? null, name: kept.name ?? null, hash: sha256(JSON.stringify(kept)) }
  })
}

/** Harness builds share the manifest URL; `env` adds the per-bundle switches. */
function harnessEnv(server, env = {}) {
  return { ...cleanEnv(), VITE_OTA_HARNESS: '1', VITE_OTA_MANIFEST_URL: `${server.origin}/ios.json`, ...env }
}

/** `vite build --mode native` into dist-native as a harness build. */
export function webBuild(server, env) {
  return run(join(BIN, 'vite'), ['build', '--mode', 'native', '--logLevel', 'warn'], { env: harnessEnv(server, env) })
}

/** A harness OTA bundle: built, zipped and encrypted with the publish script's steps, then served. */
export async function otaBundle(server, keys, workRoot, label, buildEnv = {}) {
  log(`building OTA bundle ${label}`, Object.keys(buildEnv).join(' '))
  await webBuild(server, buildEnv)
  return packBundle(server, keys, workRoot, label)
}

/** Zips and encrypts whatever dist-native holds; a second call gives a re-encrypted copy at a new URL. */
export function packBundle(server, keys, workRoot, label) {
  const workDir = mkdtempSync(join(workRoot, `pack-${label}-`))
  const env = { ...cleanEnv(), UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: keys.pub }
  const { file, checksum, sessionKey } = capgoPack(REPO, { label, keyFile: keys.key, workDir, env })
  const hash = sha256(readFileSync(file))
  return { version: label, file, hash, checksum, sessionKey, url: server.publish(file, `${hash}.zip`) }
}

/** The published manifest shape for a served bundle. */
export const manifestFor = (bundle, minNativeBuild = 0) => ({
  schema: 1,
  version: bundle.version,
  url: bundle.url,
  checksum: bundle.checksum,
  sessionKey: bundle.sessionKey,
  minNativeBuild,
})

/**
 * The Debug simulator app with `label` built in and `CFBundleVersion` set to
 * `build`: a harness web build, `cap sync ios` with the harness overrides,
 * then an unsigned xcodebuild. Returns the .app path.
 */
export async function nativeBuild(server, keys, derivedData, { label, build }) {
  log(`building native app ${build} with built-in ${label}`)
  await webBuild(server)
  await run(join(BIN, 'cap'), ['sync', 'ios'], {
    env: {
      ...cleanEnv(),
      UNSETTLED_OTA_HARNESS: '1',
      UNSETTLED_OTA_BUILTIN_VERSION: label,
      UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: keys.pub,
    },
  })
  await run('xcodebuild', [
    '-project', 'ios/App/App.xcodeproj',
    '-scheme', 'App',
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', derivedData,
    '-quiet',
    'CODE_SIGNING_ALLOWED=NO',
    `CURRENT_PROJECT_VERSION=${build}`,
    'build',
  ])
  return join(derivedData, 'Build/Products/Debug-iphonesimulator/App.app')
}
