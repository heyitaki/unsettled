import type { Game } from '../model/game'
import { newId } from '../model/ids'
import { parseGame, serializeGame } from '../model/serialization'
import { MAPS_CORRUPT_KEY, MAPS_KEY, MAX_MAPS, WORKSPACE_CORRUPT_KEY, type WorkspaceTab } from './localStorage'

interface BackupMap {
  id: string
  name: string
  game: Game
  createdAt?: number
  modifiedAt?: number
  openedAt?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseMap(value: unknown): BackupMap | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id ||
    typeof value.name !== 'string' || !value.name.trim()) return null
  const parsed = parseGame(value.game ?? value.board)
  if (!parsed.ok) return null
  const map: BackupMap = { id: value.id, name: value.name, game: parsed.game }
  for (const key of ['createdAt', 'modifiedAt', 'openedAt'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) return null
    map[key] = value[key]
  }
  return map
}

export function createLibraryBackup(tabs: readonly WorkspaceTab[]): string {
  const recovery: Record<string, string> = {}
  const read = (key: string) => {
    try { return localStorage.getItem(key) } catch (error) {
      recovery[`${key}.read-error`] = error instanceof Error ? error.message : 'Unable to read browser storage'
      return null
    }
  }
  const raw = read(MAPS_KEY)
  let entries: unknown[] = []
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw)
      if (!Array.isArray(value)) throw new Error('Unreadable library')
      entries = value
    } catch { recovery[MAPS_KEY] = raw }
  }
  const maps = entries.flatMap((entry) => {
    const map = parseMap(entry)
    if (map) return [map]
    if (raw !== null) recovery[MAPS_KEY] = raw
    return []
  })
  for (const tab of tabs) {
    const index = maps.findIndex((map) => map.id === tab.mapId)
    if (index >= 0) maps[index] = { ...maps[index], name: tab.title, game: tab.game }
    else maps.push({ id: tab.mapId ?? tab.id, name: tab.title, game: tab.game })
  }
  for (const key of [MAPS_CORRUPT_KEY, WORKSPACE_CORRUPT_KEY]) {
    const value = read(key)
    if (value !== null) recovery[key] = value
  }
  return JSON.stringify({ format: 'unsettled-library', version: 1, maps, recovery }, null, 2)
}

export function restoreLibraryBackup(data: unknown): { ok: true; count: number } | { ok: false; error: string } {
  try {
    const value: unknown = typeof data === 'string' ? JSON.parse(data) : data
    if (!isRecord(value) || value.format !== 'unsettled-library' || value.version !== 1 || !Array.isArray(value.maps)) {
      throw new Error('Not a supported Unsettled library backup')
    }
    if (value.maps.length > MAX_MAPS) throw new Error(`A backup can restore at most ${MAX_MAPS} boards at once`)
    const incoming = value.maps.map(parseMap)
    if (incoming.some((map) => map === null)) throw new Error('Backup contains an invalid board')
    const valid = incoming as BackupMap[]
    if (new Set(valid.map((map) => map.id)).size !== valid.length) throw new Error('Backup contains duplicate board IDs')
    const raw: unknown = JSON.parse(localStorage.getItem(MAPS_KEY) ?? '[]')
    if (!Array.isArray(raw) || raw.some((entry) => parseMap(entry) === null)) {
      throw new Error('Export and recover the unreadable library before restoring a backup')
    }
    const maps = raw.map(parseMap) as BackupMap[]
    const names = new Set(maps.map((map) => map.name))
    let count = 0
    for (const incomingMap of valid) {
      const existing = maps.find((map) => map.id === incomingMap.id)
      if (existing && serializeGame(existing.game) === serializeGame(incomingMap.game)) continue
      let name = incomingMap.name
      let suffix = 1
      while (names.has(name)) name = `${incomingMap.name} (${suffix++})`
      names.add(name)
      maps.push({ ...incomingMap, id: existing ? newId() : incomingMap.id, name })
      count += 1
    }
    if (maps.length > MAX_MAPS) throw new Error(`Restore would exceed ${MAX_MAPS} boards. Make room in the library first.`)
    if (count > 0) localStorage.setItem(MAPS_KEY, JSON.stringify(maps))
    return { ok: true, count }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to restore backup' }
  }
}
