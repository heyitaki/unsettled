import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './ui/App'
import { receiveSharedImage, SHARE_EVENT } from './ui/sharedImage'

// Reclaim the runtime cache left by name recognition on earlier versions.
if ('caches' in window) void caches.delete('unsettled-ocr').catch(() => {})

registerSW({
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('unsettled:notice', {
      detail: 'Ready to use offline.',
    }))
  },
})

window.addEventListener(SHARE_EVENT, (event) => {
  const file: unknown = (event as CustomEvent<unknown>).detail
  if (file instanceof File) receiveSharedImage(file)
})

void (async () => {
  // A failed boot costs the restore and share listener, never the app itself.
  if (import.meta.env.MODE === 'native') {
    if (import.meta.env.VITE_OTA_HARNESS === '1') {
      await (await import('./native/otaHarness')).record('boot')
      // The harness's bad bundle: thrown outside every catch below, so nothing
      // mounts and notifyAppReady() never runs.
      if (import.meta.env.VITE_OTA_HARNESS_FAIL === '1') throw new Error('ota-harness bad bundle')
    }
    await import('./native/ios').then((ios) => ios.bootNative()).catch((error: unknown) => console.error(error))
    // Never settles once it has switched bundles, so the reloading page never
    // mounts; any failure mounts on the current bundle.
    await import('./native/ota').then((ota) => ota.applyAtColdStart()).catch((error: unknown) => console.error(error))
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})()
