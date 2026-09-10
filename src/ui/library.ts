import type { ListedMap } from '../persistence/localStorage'

export type SortKey = 'name' | 'modifiedAt' | 'createdAt' | 'openedAt'

// The menu's own labels, keyed by every SortKey so adding a key is a compile
// error rather than a blank sort trigger at runtime. Declaration order is menu
// order.
export const SORT_MENU_LABEL: Record<SortKey, string> = {
  modifiedAt: 'Last modified',
  createdAt: 'Created',
  openedAt: 'Last opened',
  name: 'Name',
}

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] =
  (Object.keys(SORT_MENU_LABEL) as SortKey[]).map((value) => ({ value, label: SORT_MENU_LABEL[value] }))

/** The library in sort order: newest stamp first, or by name. Never mutates the input. */
export function sortMaps(maps: readonly ListedMap[], sortKey: SortKey): ListedMap[] {
  return [...maps].sort((left, right) => {
    if (sortKey === 'name') return left.name.localeCompare(right.name)
    const leftTimestamp = typeof left[sortKey] === 'number' ? left[sortKey] : -Infinity
    const rightTimestamp = typeof right[sortKey] === 'number' ? right[sortKey] : -Infinity
    if (leftTimestamp === rightTimestamp) return 0
    return rightTimestamp > leftTimestamp ? 1 : -1
  })
}

/** The stamp a row shows: the sorted one, or the modified time when sorted by name. */
export const stampFor = (map: ListedMap, sortKey: SortKey): number | undefined =>
  sortKey === 'name' ? map.modifiedAt : map[sortKey]

const UNITS: [number, string][] = [
  [604800, 'w'],
  [86400, 'd'],
  [3600, 'h'],
  [60, 'm'],
]

// Compact timestamps fit the narrow rail.
export function relativeTime(ts: number, now = Date.now()): string {
  const seconds = Math.round((now - ts) / 1000)
  if (seconds < 45) return 'just now'
  const [size, suffix] = UNITS.find(([n]) => seconds >= n) ?? [1, 's']
  return `${Math.floor(seconds / size)}${suffix} ago`
}
