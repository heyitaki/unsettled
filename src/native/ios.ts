import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { CapacitorShareTarget } from '@capgo/capacitor-share-target'
import { MIRRORED_KEYS } from '../persistence/localStorage'
import { receiveSharedImage } from '../ui/sharedImage'

const pending = new Map<string, string>()
const writing = new Set<string>()

export async function mirrorKey(key: string, value: string): Promise<void> {
  pending.set(key, value)
  if (writing.has(key)) return
  writing.add(key)
  const path = `unsettled/${key}.json`
  while (pending.has(key)) {
    const data = pending.get(key)!
    pending.delete(key)
    try {
      await Filesystem.writeFile({ path: `${path}.tmp`, data, directory: Directory.Library, encoding: Encoding.UTF8, recursive: true })
      await Filesystem.rename({ from: `${path}.tmp`, to: path, directory: Directory.Library })
    } catch (error) {
      console.warn(`Unable to mirror ${key}`, error)
    }
  }
  writing.delete(key)
}

export async function bootNative(): Promise<void> {
  const missing = MIRRORED_KEYS.filter((key) => localStorage.getItem(key) === null)
  if (missing.length > 0) {
    await Promise.all(missing.map(async (key) => {
      for (const suffix of ['', '.tmp']) {
        try {
          const { data } = await Filesystem.readFile({ path: `unsettled/${key}.json${suffix}`, directory: Directory.Library, encoding: Encoding.UTF8 })
          if (typeof data !== 'string') continue
          JSON.parse(data)
          localStorage.setItem(key, data)
          return
        } catch {
          // First launch has no copy; an interrupted write may leave only the temp file.
        }
      }
    }))
  }
  // Refresh both copies on every launch, unawaited: a key written by a build
  // that predates the copy, or by any path that skips storeKey, still lands.
  for (const key of MIRRORED_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) void mirrorKey(key, value)
  }
  void CapacitorShareTarget.addListener('shareReceived', async (event) => {
    try {
      const file = event.files?.[0]
      if (!file) return
      const response = await fetch(Capacitor.convertFileSrc(file.uri))
      const blob = await response.blob()
      receiveSharedImage(new File([blob], file.name, { type: file.mimeType }))
    } catch (error) {
      notice(`Screenshot import failed: ${errorMessage(error)}`)
    }
  })
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'unknown error'
const notice = (detail: string) => window.dispatchEvent(new CustomEvent('unsettled:notice', { detail }))

/**
 * Writes an export to Documents, which the Files app shows, then offers it on
 * the share sheet: WKWebView ignores a blob download. `name` becomes a file
 * name, so path separators are replaced and its length is capped well under
 * the 255-byte limit (60 code points of at most 4 bytes, plus the extension).
 */
export async function saveFile(name: string, extension: string, contents: string): Promise<void> {
  const fileName = `${Array.from(name.replace(/[/\\:]/g, '-')).slice(0, 60).join('')}${extension}`
  try {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: contents, directory: Directory.Documents, encoding: Encoding.UTF8 })
    await Share.share({ files: [uri] })
  } catch (error) {
    // Dismissing the share sheet rejects too, and is no failure.
    if (errorMessage(error) !== 'Share canceled') notice(`Export failed: ${errorMessage(error)}`)
  }
}
