// Builds the iOS OTA bundle and its manifest for the site deploy:
//   node tools/ota/publish.mjs --out <dir> --base-url https://akshath.me/unsettled-ota
// Run from the unsettled checkout. Writes <out>/bundles/<sha256>.zip, then
// <out>/ios.json last, so a failure never leaves a manifest naming a missing zip.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const APP_ID = 'me.akshath.unsettled'
const STORE_TAG = /^store\/ios\/(\d{8})\.(\d{4})$/
const SENTINEL = Number.MAX_SAFE_INTEGER
// The CLI and Vite come from this checkout's own node_modules, never a registry fetch.
const TOOLS = fileURLToPath(new URL('../../node_modules/.bin/', import.meta.url))
const NO_NETWORK = fileURLToPath(new URL('./no-network.cjs', import.meta.url))

export class Refusal extends Error {}

const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

// What a store binary can run: its native project, the config and key baked into
// it, the epoch, and the versions of the plugins Package.swift links. See
// CLAUDE.md for when to bump ota/native-epoch.
export function nativeFingerprint(repo, commit) {
  const lines = [git(repo, 'ls-tree', '-r', commit, 'ios/App/')]
  for (const path of ['capacitor.config.ts', 'ota/keys/bundle.pub', 'ota/native-epoch']) {
    const entry = git(repo, 'ls-tree', commit, '--', path).trim()
    lines.push(`${path} ${entry ? entry.split(/\s+/)[2] : 'missing'}\n`)
  }
  const show = (path) => {
    try {
      return execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    } catch {
      return null
    }
  }
  const swift = show('ios/App/CapApp-SPM/Package.swift') ?? ''
  const lockText = show('package-lock.json')
  const lock = lockText ? JSON.parse(lockText).packages ?? {} : {}
  const names = [...new Set([...swift.matchAll(/node_modules\/((?:@[^/"]+\/)?[^/"]+)/g)].map((m) => m[1]))].sort()
  for (const name of names) lines.push(`${name} ${lock[`node_modules/${name}`]?.version ?? 'missing'}\n`)
  return sha256(lines.join(''))
}

export function storeTags(repo) {
  return git(repo, 'tag', '--list', 'store/ios/*')
    .split('\n')
    .flatMap((tag) => {
      const m = STORE_TAG.exec(tag)
      return m ? [{ tag, build: Number(m[1] + m[2]) }] : []
    })
    .sort((a, b) => b.build - a.build)
}

// The smallest build of the newest uninterrupted run of store tags whose
// fingerprint equals HEAD's; the sentinel (no phone downloads) when the newest
// differs. Only the latest run counts, so after an A/B/A revert, B phones (which
// lack A's native code) are not admitted by build number alone.
export function minNativeBuild(repo, tags = storeTags(repo)) {
  const head = nativeFingerprint(repo, 'HEAD')
  let min = SENTINEL
  for (const { tag, build } of tags) {
    if (nativeFingerprint(repo, git(repo, 'rev-parse', `${tag}^{commit}`).trim()) !== head) break
    min = build
  }
  return min
}

export const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_OTA_') && !k.startsWith('UNSETTLED_OTA_')),
  )

function viteBuild(repo) {
  execFileSync(join(TOOLS, 'vite'), ['build', '--mode', 'native'], { cwd: repo, env: cleanEnv(), stdio: 'inherit' })
}

// Zips dist-native (the CLI also checks it calls notifyAppReady()) and encrypts
// it, offline under the no-network preload (the simulator harness packs its
// bundles with it too). Returns the encrypted zip's path and
// the manifest's checksum and sessionKey. The CLI loads capacitor.config.ts,
// so the harness passes `env` with its throwaway public key.
export function capgoPack(repo, { label, keyFile, workDir, env = cleanEnv() }) {
  const run = (...args) =>
    JSON.parse(
      execFileSync(join(TOOLS, 'capgo'), [...args, '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...env, NODE_OPTIONS: `--require ${NO_NETWORK}` },
        stdio: ['ignore', 'pipe', 'inherit'],
      }),
    )
  const zip = join(workDir, 'bundle.zip')
  const zipped = run('bundle', 'zip', APP_ID, '--path', 'dist-native', '--bundle', label, '--name', zip)
  const encrypted = run('bundle', 'encrypt', zip, zipped.checksum, '--key', keyFile)
  if (!encrypted.checksum || !encrypted.ivSessionKey || !encrypted.filename) {
    throw new Error(`bundle encrypt printed no checksum, ivSessionKey or filename`)
  }
  return { file: encrypted.filename, checksum: encrypted.checksum, sessionKey: encrypted.ivSessionKey }
}

export function publish({ repo = process.cwd(), out, baseUrl, env = process.env, build = viteBuild, pack = capgoPack }) {
  if (git(repo, 'rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Refusal('refusing: shallow clone (the label counts commits)')
  }
  const tags = storeTags(repo)
  if (tags.length === 0) throw new Refusal('refusing: no store/ios/YYYYMMDD.HHMM tag (was the clone made without tags?)')
  const privateKey = env.OTA_BUNDLE_PRIVATE_KEY
  if (!privateKey) throw new Refusal('refusing: OTA_BUNDLE_PRIVATE_KEY is unset or empty')

  const label = `1.0.${git(repo, 'rev-list', '--count', 'HEAD').trim()}`
  const min = minNativeBuild(repo, tags)
  const workDir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'unsettled-ota-'))
  // Signals skip `finally`, so they clean up too: the private key never outlives the run.
  const cleanup = () => rmSync(workDir, { recursive: true, force: true })
  const onSignal = () => {
    cleanup()
    process.exit(1)
  }
  process.once('SIGINT', onSignal).once('SIGTERM', onSignal)
  try {
    const keyFile = join(workDir, 'bundle.key')
    writeFileSync(keyFile, privateKey, { mode: 0o600 })
    build(repo)
    const { file, checksum, sessionKey } = pack(repo, { label, keyFile, workDir })
    const hash = sha256(readFileSync(file))
    const manifest = {
      schema: 1,
      version: label,
      url: `${baseUrl.replace(/\/+$/, '')}/bundles/${hash}.zip`,
      checksum,
      sessionKey,
      minNativeBuild: min,
    }
    mkdirSync(join(out, 'bundles'), { recursive: true })
    copyFileSync(file, join(out, 'bundles', `${hash}.zip`))
    writeFileSync(join(out, 'ios.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    return manifest
  } finally {
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal)
    cleanup()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'base-url': { type: 'string' } } })
  if (!values.out || !values['base-url']) {
    console.error('usage: node tools/ota/publish.mjs --out <dir> --base-url <url>')
    process.exit(2)
  }
  try {
    const manifest = publish({ out: resolve(values.out), baseUrl: values['base-url'] })
    console.log(`published ${manifest.version} (minNativeBuild ${manifest.minNativeBuild})`)
  } catch (error) {
    console.error(error instanceof Refusal ? error.message : error)
    process.exit(1)
  }
}
