import { parseBoard, serializeBoard, type ParseBoardResult } from '../model/serialization'
import type { Board } from '../model/types'

export const MAPS_KEY = 'unsettled.maps.v1'
export const CURRENT_KEY = 'unsettled.current.v1'
export const MAPS_CORRUPT_KEY = `${MAPS_KEY}.corrupt`

export interface ListedMap {
  name: string
  valid: boolean
  errors?: string[]
}

type WriteResult = { ok: true } | { ok: false; error: string }
let corruptMapsBlob: string | null = null

function isNamedMapEntry(entry: unknown): entry is Record<string, unknown> & { name: string } {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).name === 'string'
}

function readRawMaps(): { entries: unknown[]; warning?: string } {
  const raw = localStorage.getItem(MAPS_KEY)
  if (raw === null) return { entries: [] }
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) throw new Error('Saved maps must be an array')
    return { entries: value }
  } catch (error) {
    corruptMapsBlob = raw
    return { entries: [], warning: error instanceof Error ? error.message : 'Corrupted saved maps' }
  }
}

function writeMaps(maps: unknown[]): WriteResult {
  try {
    if (corruptMapsBlob !== null) {
      localStorage.setItem(MAPS_CORRUPT_KEY, corruptMapsBlob)
      corruptMapsBlob = null
    }
    localStorage.setItem(MAPS_KEY, JSON.stringify(maps))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to write localStorage' }
  }
}

export function listMaps(): { maps: ListedMap[]; warning?: string } {
  const raw = readRawMaps()
  const maps: ListedMap[] = raw.entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { name: `Invalid map ${index + 1}`, valid: false, errors: ['Entry must be an object'] }
    }
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : `Invalid map ${index + 1}`
    const parsed = parseBoard(record.board)
    return parsed.ok ? { name, valid: true } : { name, valid: false, errors: parsed.errors }
  })
  return { maps, ...(raw.warning ? { warning: raw.warning } : {}) }
}

export function saveMap(name: string, board: Board, overwrite = false): WriteResult {
  if (name.length === 0) return { ok: false, error: 'Map name cannot be empty' }
  const maps = [...readRawMaps().entries]
  const index = maps.findIndex((entry) => isNamedMapEntry(entry) && entry.name === name)
  if (index >= 0 && !overwrite) return { ok: false, error: 'A map with this name already exists' }
  const entry = { name, board }
  if (index >= 0) maps[index] = entry
  else maps.push(entry)
  return writeMaps(maps)
}

export function loadMap(name: string): ParseBoardResult {
  for (const entry of readRawMaps().entries) {
    if (isNamedMapEntry(entry) && entry.name === name) return parseBoard(entry.board)
  }
  return { ok: false, errors: [`Map "${name}" was not found`] }
}

export function deleteMap(name: string): WriteResult {
  const maps = readRawMaps().entries.filter((entry) => {
    return !isNamedMapEntry(entry) || entry.name !== name
  })
  return writeMaps(maps)
}

export function autosaveCurrent(board: Board): WriteResult {
  try {
    localStorage.setItem(CURRENT_KEY, serializeBoard(board))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to autosave' }
  }
}

export function loadCurrent(): ParseBoardResult {
  const value = localStorage.getItem(CURRENT_KEY)
  return value === null ? { ok: false, errors: ['No autosave found'] } : parseBoard(value)
}
