import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Refusal, minNativeBuild, nativeFingerprint, publish } from '../publish.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SENTINEL = Number.MAX_SAFE_INTEGER
const scratch = mkdtempSync(join(tmpdir(), 'unsettled-publish-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const lock = (updater, unrelated = '1.0.0') =>
  JSON.stringify({
    packages: {
      '': {},
      'node_modules/@capgo/capacitor-updater': { version: updater },
      'node_modules/@capacitor/app': { version: '8.1.2' },
      'node_modules/left-pad': { version: unrelated },
    },
  })

const BASE = {
  'ios/App/App/Info.plist': '<plist/>\n',
  'ios/App/CapApp-SPM/Package.swift':
    '.package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),\n' +
    '.package(name: "CapgoCapacitorUpdater", path: "../../../node_modules/@capgo/capacitor-updater")\n',
  'ios/archive.sh': '#!/bin/sh\n',
  'package-lock.json': lock('8.54.2'),
  'capacitor.config.ts': 'export default {}\n',
  'ota/keys/bundle.pub': 'key one\n',
  'ota/native-epoch': '1\n',
  'src/app.ts': 'export {}\n',
}

const without = (path) => Object.fromEntries(Object.entries(BASE).filter(([p]) => p !== path))

let fixtures = 0
// A throwaway git repo; `commit` writes files (null deletes) and returns the sha.
function fixture(files = BASE) {
  const dir = join(scratch, `repo-${fixtures++}`)
  mkdirSync(dir)
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'fixture@example.com')
  git('config', 'user.name', 'fixture')
  git('config', 'commit.gpgsign', 'false')
  const commit = (changes, message = 'change') => {
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) rmSync(join(dir, path))
      else {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), content)
      }
    }
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const tag = (build, ref = 'HEAD', annotated = false) =>
    git('tag', ...(annotated ? ['-a', '-m', build] : []), `store/ios/${build}`, ref)
  commit(files, 'base')
  return { dir, git, commit, tag }
}

describe('minNativeBuild', () => {
  it('gives a matching tag its build, and a web-only commit keeps the fingerprint', () => {
    const r = fixture()
    const base = nativeFingerprint(r.dir, 'HEAD')
    r.tag('20261101.0900', 'HEAD', true)
    r.commit({ 'src/app.ts': 'export const x = 1\n', 'package-lock.json': lock('8.54.2', '2.0.0') })
    expect(nativeFingerprint(r.dir, 'HEAD')).toBe(base)
    expect(minNativeBuild(r.dir)).toBe(202611010900)
  })

  it('takes the smallest build of several matching tags', () => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit({ 'src/app.ts': 'export const x = 1\n' })
    r.tag('20261102.1000')
    r.tag('20261103.1100', 'HEAD', true)
    r.commit({ 'src/app.ts': 'export const x = 2\n' })
    expect(minNativeBuild(r.dir)).toBe(202611010900)
  })

  it('ignores tags that do not match the store form', () => {
    const r = fixture()
    r.git('tag', 'store/ios/20261101')
    r.git('tag', 'store/ios/x20261101.0900')
    r.tag('20261102.1000')
    expect(minNativeBuild(r.dir)).toBe(202611021000)
  })

  it.each([
    ['an ios/App/ change', { 'ios/App/App/Info.plist': '<plist version="2"/>\n' }],
    ['a referenced plugin version change in the lockfile', { 'package-lock.json': lock('8.55.0') }],
    ['a capacitor.config.ts change', { 'capacitor.config.ts': 'export default { a: 1 }\n' }],
    ['a key change', { 'ota/keys/bundle.pub': 'key two\n' }],
    ['an epoch bump', { 'ota/native-epoch': '2\n' }],
  ])('gives the sentinel after %s', (_, change) => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit(change)
    expect(minNativeBuild(r.dir)).toBe(SENTINEL)
  })

  it('keeps the fingerprint across an ios/archive.sh change', () => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit({ 'ios/archive.sh': '#!/bin/sh\necho archive\n' })
    expect(minNativeBuild(r.dir)).toBe(202611010900)
  })

  it('hashes a tag whose commit predates ota/native-epoch', () => {
    const r = fixture(without('ota/native-epoch'))
    r.tag('20261101.0900')
    r.commit({ 'ota/native-epoch': '1\n' })
    expect(minNativeBuild(r.dir)).toBe(SENTINEL)
  })

  it('gives the sentinel when HEAD returns to an older native state (A, B, A)', () => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit({ 'ios/App/App/Info.plist': '<plist version="2"/>\n' })
    r.tag('20261102.0900')
    r.commit({ 'ios/App/App/Info.plist': BASE['ios/App/App/Info.plist'] })
    expect(minNativeBuild(r.dir)).toBe(SENTINEL)
  })
})

describe('publish', () => {
  // Stands in for the CLI: writes an "encrypted zip" and records the key file it was given.
  const stubPack = (seen) => (_repo, { label, keyFile, workDir }) => {
    seen.keyFile = keyFile
    seen.keyMode = statSync(keyFile).mode & 0o777
    seen.key = readFileSync(keyFile, 'utf8')
    const file = join(workDir, 'enc.zip')
    writeFileSync(file, `zip ${label}`)
    return { file, checksum: 'signed-checksum', sessionKey: 'iv:session' }
  }
  const run = (repo, overrides = {}) => {
    const out = join(scratch, `out-${fixtures++}`)
    const seen = {}
    const call = () =>
      publish({
        repo,
        out,
        baseUrl: 'https://akshath.me/unsettled-ota/',
        env: { OTA_BUNDLE_PRIVATE_KEY: 'PRIVATE', RUNNER_TEMP: scratch },
        build: () => {},
        pack: stubPack(seen),
        ...overrides,
      })
    return { out, seen, call }
  }

  it('writes the bundle and a manifest of exactly the six fields', () => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit({ 'src/app.ts': 'export const x = 1\n' })
    const { out, seen, call } = run(r.dir)
    const manifest = call()
    const onDisk = JSON.parse(readFileSync(join(out, 'ios.json'), 'utf8'))
    expect(onDisk).toEqual(manifest)
    expect(Object.keys(onDisk).sort()).toEqual(['checksum', 'minNativeBuild', 'schema', 'sessionKey', 'url', 'version'])
    const hash = /^https:\/\/akshath\.me\/unsettled-ota\/bundles\/([0-9a-f]{64})\.zip$/.exec(onDisk.url)?.[1]
    expect(hash).toBeTruthy()
    expect(onDisk).toMatchObject({
      schema: 1,
      version: '1.0.2',
      checksum: 'signed-checksum',
      sessionKey: 'iv:session',
      minNativeBuild: 202611010900,
    })
    expect(readFileSync(join(out, 'bundles', `${hash}.zip`), 'utf8')).toBe('zip 1.0.2')
    expect(seen).toMatchObject({ keyMode: 0o600, key: 'PRIVATE' })
    expect(existsSync(seen.keyFile)).toBe(false)
  })

  it('deletes the key and writes no manifest when packing fails', () => {
    const r = fixture()
    r.tag('20261101.0900')
    const seen = {}
    const { out, call } = run(r.dir, {
      pack: (...args) => {
        stubPack(seen)(...args)
        throw new Error('encrypt failed')
      },
    })
    expect(call).toThrow('encrypt failed')
    expect(existsSync(seen.keyFile)).toBe(false)
    expect(existsSync(join(out, 'ios.json'))).toBe(false)
  })

  const refuses = (repo, pattern, overrides) => {
    let built = false
    const { out, call } = run(repo, { build: () => (built = true), ...overrides })
    expect(call).toThrow(Refusal)
    expect(call).toThrow(pattern)
    expect(built).toBe(false)
    expect(existsSync(out)).toBe(false)
  }

  it('refuses a shallow clone', () => {
    const r = fixture()
    r.tag('20261101.0900')
    r.commit({ 'src/app.ts': 'export const x = 1\n' })
    const shallow = join(scratch, `shallow-${fixtures++}`)
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.dir}`, shallow])
    refuses(shallow, /shallow/)
  })

  it('refuses when there is no store tag', () => {
    const r = fixture()
    r.git('tag', 'v1')
    refuses(r.dir, /no store\/ios/)
  })

  it('refuses without a private key', () => {
    const r = fixture()
    r.tag('20261101.0900')
    refuses(r.dir, /OTA_BUNDLE_PRIVATE_KEY/, { env: { OTA_BUNDLE_PRIVATE_KEY: '' } })
  })

  // The one test that runs the real CLI zip and encrypt (under the no-network
  // preload); the Vite build is stubbed with a tiny bundle.
  it('zips and encrypts with the installed Capgo CLI', () => {
    const r = fixture({
      ...without('capacitor.config.ts'),
      'capacitor.config.json': JSON.stringify({ appId: 'me.akshath.unsettled', appName: 'U', webDir: 'dist-native' }),
      'package.json': readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    })
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(r.dir, 'node_modules'))
    r.tag('20261101.0900')
    const privateKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    }).privateKey
    const { out, call } = run(r.dir, {
      env: { OTA_BUNDLE_PRIVATE_KEY: privateKey, RUNNER_TEMP: scratch },
      build: (repo) => {
        mkdirSync(join(repo, 'dist-native'))
        writeFileSync(join(repo, 'dist-native', 'index.html'), '<script src="a.js"></script>')
        writeFileSync(join(repo, 'dist-native', 'a.js'), 'CapacitorUpdater.notifyAppReady()')
      },
      pack: undefined,
    })
    const manifest = call()
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64,}$/)
    expect(manifest.sessionKey).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
    expect(existsSync(join(out, 'bundles', manifest.url.split('/').pop()))).toBe(true)
  }, 60_000)
})
