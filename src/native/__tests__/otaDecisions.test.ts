import { describe, expect, it } from 'vitest'
import { type BundleEntry, type Manifest, checkOutcome, chooseCandidate, isNewer, parseLabel, parseManifest, parseNativeBuild, runningLabel } from '../otaDecisions'

const manifest: Manifest = {
  schema: 1,
  version: '1.0.530',
  url: 'https://akshath.me/unsettled-ota/bundles/abc.zip',
  checksum: 'signed',
  sessionKey: 'iv:key',
  minNativeBuild: 202611140000,
}
const body = (overrides: Record<string, unknown> = {}) => JSON.stringify({ ...manifest, ...overrides })
const entry = (id: string, version: string, status: string): BundleEntry => ({ id, version, status })

describe('labels', () => {
  it('parses three integers and rejects anything else', () => {
    expect(parseLabel('1.0.521')).toEqual([1, 0, 521])
    for (const bad of ['1.0', '1.0.5.1', 'v1.0.5', '1.0.x', '', ' 1.0.5', '1.0.5-beta']) expect(parseLabel(bad)).toBeNull()
  })

  it('compares numerically, not lexically', () => {
    expect(isNewer('1.0.10', '1.0.9')).toBe(true)
    expect(isNewer('1.0.9', '1.0.10')).toBe(false)
    expect(isNewer('2.0.0', '1.9.99')).toBe(true)
    expect(isNewer('1.0.5', '1.0.5')).toBe(false)
  })

  it('never ranks an invalid label as newer', () => {
    expect(isNewer('garbage', '1.0.1')).toBe(false)
    expect(isNewer('garbage', 'garbage')).toBe(false)
    expect(isNewer('1.0.1', 'garbage')).toBe(true)
  })
})

describe('native build', () => {
  it('drops the dot of a dotted build', () => expect(parseNativeBuild('20261113.1956')).toBe(202611131956))
  it('reads an undotted build', () => expect(parseNativeBuild('42')).toBe(42))
  it('rejects anything else', () => {
    for (const bad of ['', '1.2.3', '1.0.0', 'abc', '20261113.', '.1956', '1e5', ' 42', '99999999999999999999']) expect(parseNativeBuild(bad)).toBeNull()
  })
})

describe('manifest validation', () => {
  it('accepts exactly the published shape', () => expect(parseManifest(body(), false)).toEqual(manifest))

  it('rejects a non-JSON body and non-object JSON', () => {
    for (const bad of ['<!DOCTYPE html><title>404</title>', '', 'null', '[]', '"x"', '1']) expect(parseManifest(bad, false)).toBeNull()
  })

  it('rejects an extra or a missing key', () => {
    expect(parseManifest(body({ extra: 1 }), false)).toBeNull()
    for (const key of Object.keys(manifest)) {
      const copy: Record<string, unknown> = { ...manifest }
      delete copy[key]
      expect(parseManifest(JSON.stringify(copy), false), key).toBeNull()
    }
  })

  it.each([
    ['schema', 2],
    ['schema', '1'],
    ['version', '1.0'],
    ['version', 530],
    ['url', 'ftp://akshath.me/x.zip'],
    ['url', 'not a url'],
    ['url', 7],
    ['checksum', ''],
    ['checksum', null],
    ['sessionKey', ''],
    ['sessionKey', 1],
    ['minNativeBuild', -1],
    ['minNativeBuild', 1.5],
    ['minNativeBuild', '202611140000'],
    ['minNativeBuild', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s = %j', (key, value) => expect(parseManifest(body({ [key]: value }), false)).toBeNull())

  it('accepts the sentinel minNativeBuild', () => expect(parseManifest(body({ minNativeBuild: Number.MAX_SAFE_INTEGER }), false)).not.toBeNull())

  it('rejects an http URL in a production build', () => {
    for (const url of ['http://akshath.me/x.zip', 'http://127.0.0.1:8123/x.zip', 'http://localhost:8123/x.zip']) expect(parseManifest(body({ url }), false)).toBeNull()
  })

  it('accepts only loopback http URLs with a port in a harness build', () => {
    expect(parseManifest(body({ url: 'http://127.0.0.1:8123/b.zip' }), true)).not.toBeNull()
    expect(parseManifest(body({ url: 'http://localhost:8123/b.zip' }), true)).not.toBeNull()
    for (const url of ['http://akshath.me/x.zip', 'http://127.0.0.1/x.zip', 'http://10.0.0.1:8123/x.zip']) expect(parseManifest(body({ url }), true)).toBeNull()
  })
})

describe('running label', () => {
  it('uses the built-in label for the built-in bundle', () => expect(runningLabel({ id: 'builtin', version: 'builtin' }, '1.0.521')).toBe('1.0.521'))
  it('uses the bundle version for a downloaded bundle', () => expect(runningLabel({ id: 'Ab12', version: '1.0.530' }, '1.0.521')).toBe('1.0.530'))
})

describe('cold-start candidate', () => {
  it('picks the newest pending bundle that is not current', () => {
    const bundles = [entry('a', '1.0.530', 'pending'), entry('b', '1.0.540', 'pending'), entry('c', '1.0.535', 'pending')]
    expect(chooseCandidate(bundles, 'builtin', '1.0.521', '1.0.521')?.id).toBe('b')
  })

  it('never picks the current bundle', () => {
    expect(chooseCandidate([entry('a', '1.0.530', 'pending')], 'a', '1.0.521', '1.0.521')).toBeNull()
  })

  it('never picks a bundle in another status', () => {
    for (const status of ['success', 'error', 'downloading', 'deleting', 'deleted']) {
      expect(chooseCandidate([entry('a', '1.0.530', status)], 'builtin', '1.0.521', '1.0.521'), status).toBeNull()
    }
  })

  it('picks nothing not newer than the running label', () => {
    expect(chooseCandidate([entry('a', '1.0.530', 'pending')], 'cur', '1.0.530', '1.0.521')).toBeNull()
    expect(chooseCandidate([entry('a', '1.0.525', 'pending')], 'cur', '1.0.530', '1.0.521')).toBeNull()
  })

  it('picks nothing not newer than the built-in label', () => {
    expect(chooseCandidate([entry('a', '1.0.530', 'pending')], 'builtin', '1.0.521', '1.0.540')).toBeNull()
  })

  it('skips a pending bundle with an invalid label', () => {
    expect(chooseCandidate([entry('a', 'junk', 'pending')], 'builtin', '1.0.521', '1.0.521')).toBeNull()
  })
})

describe('check outcome', () => {
  const run = (m: Manifest | null, opts: { running?: string; builtin?: string; native?: number | null; bundles?: BundleEntry[] } = {}) =>
    checkOutcome(m, opts.running ?? '1.0.521', opts.builtin ?? '1.0.521', opts.native === undefined ? 202611140000 : opts.native, opts.bundles ?? [])

  it('leaves the store note unchanged on no information', () => expect(run(null)).toEqual({ storeNote: 'unchanged', download: false }))

  it('downloads a newer manifest the native build can run and clears the note', () => {
    expect(run(manifest)).toEqual({ storeNote: 'clear', download: true })
    expect(run(manifest, { native: 202611140001 })).toEqual({ storeNote: 'clear', download: true })
  })

  it('sets the store note only when newer and minNativeBuild exceeds a parseable native build', () => {
    expect(run(manifest, { native: 202611131959 })).toEqual({ storeNote: 'set', download: false })
    expect(run({ ...manifest, minNativeBuild: Number.MAX_SAFE_INTEGER })).toEqual({ storeNote: 'set', download: false })
  })

  it('clears the note for any manifest when the native build is unparseable', () => {
    expect(run(manifest, { native: null })).toEqual({ storeNote: 'clear', download: false })
    expect(run({ ...manifest, minNativeBuild: Number.MAX_SAFE_INTEGER }, { native: null })).toEqual({ storeNote: 'clear', download: false })
  })

  it('clears the note and skips a manifest not newer than the running label', () => {
    expect(run(manifest, { running: '1.0.530' })).toEqual({ storeNote: 'clear', download: false })
    expect(run(manifest, { running: '1.0.600' })).toEqual({ storeNote: 'clear', download: false })
    expect(run({ ...manifest, minNativeBuild: Number.MAX_SAFE_INTEGER }, { running: '1.0.600' })).toEqual({ storeNote: 'clear', download: false })
  })

  it('clears the note and skips a manifest not newer than the built-in label', () => {
    expect(run(manifest, { builtin: '1.0.530' })).toEqual({ storeNote: 'clear', download: false })
  })

  it('never downloads a version already listed as pending, success or error', () => {
    for (const status of ['pending', 'success', 'error']) {
      expect(run(manifest, { bundles: [entry('x', '1.0.530', status)] }), status).toEqual({ storeNote: 'clear', download: false })
    }
  })

  it('downloads a version listed only as downloading or deleting', () => {
    for (const status of ['downloading', 'deleting']) {
      expect(run(manifest, { bundles: [entry('x', '1.0.530', status)] }), status).toEqual({ storeNote: 'clear', download: true })
    }
  })

  it('is not blocked by another version in the list', () => {
    expect(run(manifest, { bundles: [entry('x', '1.0.529', 'error')] })).toEqual({ storeNote: 'clear', download: true })
  })
})
