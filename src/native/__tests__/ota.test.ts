import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
  current: vi.fn(),
  getBuiltinVersion: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
  download: vi.fn(),
  notifyAppReady: vi.fn(),
}))
const app = vi.hoisted(() => ({ getInfo: vi.fn(), addListener: vi.fn() }))
vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: plugin }))
vi.mock('@capacitor/app', () => ({ App: app }))

const manifest = {
  schema: 1,
  version: '1.0.530',
  url: 'https://akshath.me/unsettled-ota/bundles/abc.zip',
  checksum: 'signed',
  sessionKey: 'iv:key',
  minNativeBuild: 202611140000,
}
const bundle = (id: string, version: string, status: string) => ({ id, version, status, downloaded: '', checksum: '' })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 20))])

const fetchMock = vi.fn<typeof fetch>()
const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

// Each test gets a fresh adapter, since it keeps per-page-load state.
const load = async () => ({ ota: await import('../ota'), status: await import('../otaStatus') })

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', fetchMock)
  plugin.current.mockResolvedValue({ bundle: bundle('builtin', '', 'success'), native: '1.0.521' })
  plugin.getBuiltinVersion.mockResolvedValue({ version: '1.0.521' })
  plugin.list.mockResolvedValue({ bundles: [] })
  plugin.set.mockResolvedValue(undefined)
  plugin.download.mockResolvedValue(bundle('x', '1.0.530', 'pending'))
  plugin.notifyAppReady.mockResolvedValue({ bundle: bundle('builtin', '', 'success') })
  app.getInfo.mockResolvedValue({ build: '20261114.1200' })
  app.addListener.mockResolvedValue({ remove: vi.fn() })
  fetchMock.mockImplementation(() => respond(manifest))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('cold start', () => {
  it('mounts on the current bundle when nothing is pending', async () => {
    const { ota, status } = await load()
    plugin.list.mockResolvedValue({ bundles: [bundle('a', '1.0.530', 'success')] })
    await expect(ota.applyAtColdStart()).resolves.toBeUndefined()
    expect(plugin.set).not.toHaveBeenCalled()
    expect(status.getOtaStatus().bundleVersion).toBe('1.0.521')
  })

  it('sets the newest candidate and never settles after set() resolves', async () => {
    const { ota } = await load()
    plugin.list.mockResolvedValue({ bundles: [bundle('a', '1.0.525', 'pending'), bundle('b', '1.0.530', 'pending')] })
    const apply = ota.applyAtColdStart()
    expect(await settled(apply)).toBe('pending')
    expect(plugin.set).toHaveBeenCalledWith({ id: 'b' })
    expect(plugin.notifyAppReady).not.toHaveBeenCalled()
  })

  it('rejects when set() rejects, so the caller mounts', async () => {
    const { ota } = await load()
    plugin.list.mockResolvedValue({ bundles: [bundle('b', '1.0.530', 'pending')] })
    plugin.set.mockRejectedValue(new Error('bundle missing'))
    await expect(ota.applyAtColdStart()).rejects.toThrow('bundle missing')
  })

  it('reads the running label from an OTA bundle', async () => {
    const { ota, status } = await load()
    plugin.current.mockResolvedValue({ bundle: bundle('b', '1.0.530', 'success'), native: '1.0.521' })
    await ota.applyAtColdStart()
    expect(status.getOtaStatus().bundleVersion).toBe('1.0.530')
  })
})

describe('ready and check', () => {
  it('calls notifyAppReady before fetching, then downloads a newer manifest', async () => {
    const { ota } = await load()
    const ready = deferred<{ bundle: ReturnType<typeof bundle> }>()
    plugin.notifyAppReady.mockReturnValue(ready.promise)
    const start = ota.startUpdates()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(app.addListener).not.toHaveBeenCalled()
    ready.resolve({ bundle: bundle('builtin', '', 'success') })
    await start
    await flush()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/akshath\.me\/unsettled-ota\/ios\.json\?t=\d+$/)
    expect(init).toMatchObject({ cache: 'no-store' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const { url: bundleUrl, version, checksum, sessionKey } = manifest
    expect(plugin.download).toHaveBeenCalledWith({ url: bundleUrl, version, checksum, sessionKey })
    expect(plugin.list).toHaveBeenCalledWith()
  })

  it('runs once per page load', async () => {
    const { ota } = await load()
    await Promise.all([ota.startUpdates(), ota.startUpdates()])
    expect(plugin.notifyAppReady).toHaveBeenCalledTimes(1)
  })

  it('drops a resume while a check is in flight, and checks on a later resume', async () => {
    const { ota } = await load()
    const first = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise)
    await ota.startUpdates()
    const onResume = app.addListener.mock.calls[0][1] as () => void
    expect(app.addListener.mock.calls[0][0]).toBe('resume')
    onResume()
    onResume()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    first.resolve(new Response('not found', { status: 404 }))
    await flush()
    onResume()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sets the store note when the manifest needs a newer native build, and downloads nothing', async () => {
    const { ota, status } = await load()
    fetchMock.mockImplementation(() => respond({ ...manifest, minNativeBuild: 999999999999 }))
    await ota.checkForUpdate()
    expect(status.getOtaStatus().storeUpdate).toBe(true)
    expect(plugin.download).not.toHaveBeenCalled()
  })

  it('leaves the store note alone when the fetch fails', async () => {
    const { ota, status } = await load()
    status.updateOtaStatus({ storeUpdate: true })
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await ota.checkForUpdate()
    expect(status.getOtaStatus().storeUpdate).toBe(true)
    expect(plugin.download).not.toHaveBeenCalled()
  })

  it('never downloads a version the plugin already lists', async () => {
    const { ota } = await load()
    plugin.list.mockResolvedValue({ bundles: [bundle('b', '1.0.530', 'error')] })
    await ota.checkForUpdate()
    expect(plugin.download).not.toHaveBeenCalled()
  })
})
