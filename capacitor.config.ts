import { execSync } from 'node:child_process'
import { createPublicKey } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CapacitorConfig } from '@capacitor/cli'

// Loaded by the Capacitor CLI from the repo root, so paths and git run from the
// working directory (the CLI transpiles this to CommonJS, where import.meta is absent).
const root = process.cwd()

// The OTA label: 1.0.<commit count>, the same rule the publish script uses for
// each OTA bundle, so the built-in bundle compares against them.
const builtinVersion =
  process.env.UNSETTLED_OTA_BUILTIN_VERSION ||
  `1.0.${execSync('git rev-list --count HEAD', { cwd: root, encoding: 'utf8' }).trim()}`

// The plugin fatalErrors at launch on an unparseable key and decrypts only with
// a PKCS#1 ("RSA PUBLIC KEY") PEM, so a build without one must fail here.
const keyFile = resolve(root, process.env.UNSETTLED_OTA_BUNDLE_PUBLIC_KEY_FILE || 'ota/keys/bundle.pub')
if (!existsSync(keyFile)) throw new Error(`OTA bundle public key missing: ${keyFile}`)
const publicKey = readFileSync(keyFile, 'utf8').trim()
const isRsaPem = (() => {
  if (!publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----')) return false
  try {
    return createPublicKey(publicKey).asymmetricKeyType === 'rsa'
  } catch {
    return false
  }
})()
if (!isRsaPem) throw new Error(`OTA bundle public key is not an RSA public key PEM: ${keyFile}`)

const config: CapacitorConfig = {
  appId: 'me.akshath.unsettled',
  appName: 'Unsettled',
  webDir: 'dist-native',
  backgroundColor: '#efe8d9',
  plugins: {
    CapacitorShareTarget: { appGroupId: 'group.me.akshath.unsettled' },
    // Manual mode with every Capgo URL blank: our boot module decides, and
    // nothing talks to Capgo's servers.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
      publicKey,
      version: builtinVersion,
      appReadyTimeout: 10000,
      resetWhenUpdate: true,
      // Keeps a failed bundle's folder and record, so it is never downloaded again.
      autoDeleteFailed: false,
      // The harness serves bundles over plain-HTTP loopback; production keeps
      // the plugin's https-only default.
      ...(process.env.UNSETTLED_OTA_HARNESS === '1' ? { httpsOnly: false } : {}),
    },
  },
}

export default config
