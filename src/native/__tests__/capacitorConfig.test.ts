import { execSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['UNSETTLED_OTA_BUILTIN_VERSION', 'UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE', 'UNSETTLED_OTA_HARNESS']

// Throwaway keys only: nothing here is ever a real bundle key.
const dir = mkdtempSync(join(tmpdir(), 'unsettled-capconfig-'))
const pem = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).publicKey
const keyFile = join(dir, 'bundle.pub')
writeFileSync(keyFile, pem)

const loadConfig = async (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  vi.resetModules()
  return (await import('../../../capacitor.config.ts')).default
}

const updater = async (env: Record<string, string>) =>
  (await loadConfig(env)).plugins?.CapacitorUpdater as Record<string, unknown>

const expected = (version: string) => ({
  autoUpdate: false,
  updateUrl: '',
  statsUrl: '',
  channelUrl: '',
  publicKey: pem.trim(),
  version,
  appReadyTimeout: 10000,
  resetWhenUpdate: true,
  autoDeleteFailed: false,
})

describe('capacitor.config.ts', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  const cwd = process.cwd()
  beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]))
  afterEach(() => {
    process.chdir(cwd)
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the app values and labels the built-in bundle by commit count', async () => {
    const config = await loadConfig({ UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: keyFile })
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
    expect(config).toMatchObject({ appId: 'me.akshath.unsettled', appName: 'Unsettled', webDir: 'dist-native' })
    expect(config.plugins?.CapacitorShareTarget).toEqual({ appGroupId: 'group.me.akshath.unsettled' })
    expect(config.plugins?.CapacitorUpdater).toEqual(expected(`1.0.${count}`))
  })

  it('takes the label override', async () => {
    const block = await updater({ UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: keyFile, UNSETTLED_OTA_BUILTIN_VERSION: '1.0.7' })
    expect(block).toEqual(expected('1.0.7'))
    expect('httpsOnly' in block).toBe(false)
  })

  it('allows plain HTTP only for the harness', async () => {
    const env = { UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: keyFile, UNSETTLED_OTA_BUILTIN_VERSION: '1.0.7' }
    expect(await updater({ ...env, UNSETTLED_OTA_HARNESS: '1' })).toEqual({ ...expected('1.0.7'), httpsOnly: false })
    expect('httpsOnly' in (await updater({ ...env, UNSETTLED_OTA_HARNESS: '0' }))).toBe(false)
  })

  it('reads ota/keys/bundle.pub by default and throws when it is missing', async () => {
    const repo = mkdtempSync(join(dir, 'repo-'))
    process.chdir(repo)
    await expect(loadConfig({ UNSETTLED_OTA_BUILTIN_VERSION: '1.0.7' })).rejects.toThrow(/public key missing/)
    mkdirSync(join(repo, 'ota/keys'), { recursive: true })
    writeFileSync(join(repo, 'ota/keys/bundle.pub'), pem)
    expect(await updater({ UNSETTLED_OTA_BUILTIN_VERSION: '1.0.7' })).toEqual(expected('1.0.7'))
  })

  it('throws on a missing override key file', async () => {
    await expect(loadConfig({ UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: join(dir, 'nope.pub') })).rejects.toThrow(
      /public key missing/,
    )
  })

  it('throws on a key file that is not an RSA public key PEM', async () => {
    const spki = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }).publicKey
    const cases = {
      garbage: 'not a key',
      spki,
      broken: '-----BEGIN RSA PUBLIC KEY-----\nAAAA\n-----END RSA PUBLIC KEY-----\n',
    }
    for (const [name, body] of Object.entries(cases)) {
      const file = join(dir, `${name}.pub`)
      writeFileSync(file, body)
      await expect(loadConfig({ UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE: file })).rejects.toThrow(/not an RSA public key PEM/)
    }
  })
})
