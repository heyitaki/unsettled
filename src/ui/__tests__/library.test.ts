import { describe, expect, it } from 'vitest'
import type { ListedMap } from '../../persistence/localStorage'
import { SORT_MENU_LABEL, SORT_OPTIONS, relativeTime, sortMaps, stampFor } from '../library'

const map = (name: string, stamps: Partial<Pick<ListedMap, 'createdAt' | 'modifiedAt' | 'openedAt'>> = {}): ListedMap => ({
  id: name,
  index: 0,
  name,
  valid: true,
  ...stamps,
})

describe('sortMaps', () => {
  const maps = [
    map('beta', { modifiedAt: 20, createdAt: 5, openedAt: 30 }),
    map('alpha', { modifiedAt: 30, createdAt: 10 }),
    map('gamma', { modifiedAt: 10, createdAt: 15, openedAt: 10 }),
  ]
  const names = (sorted: readonly ListedMap[]) => sorted.map((entry) => entry.name)

  it('puts the newest stamp first for the timestamp keys', () => {
    expect(names(sortMaps(maps, 'modifiedAt'))).toEqual(['alpha', 'beta', 'gamma'])
    expect(names(sortMaps(maps, 'createdAt'))).toEqual(['gamma', 'alpha', 'beta'])
  })

  it('sends a map with no stamp for the key to the end', () => {
    expect(names(sortMaps(maps, 'openedAt'))).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('sorts by name with locale rules and leaves the input alone', () => {
    expect(names(sortMaps(maps, 'name'))).toEqual(['alpha', 'beta', 'gamma'])
    expect(names(maps)).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('offers every key in menu order, Last modified first', () => {
    expect(SORT_OPTIONS.map((option) => option.label)).toEqual(['Last modified', 'Created', 'Last opened', 'Name'])
    expect(SORT_OPTIONS[0].value).toBe('modifiedAt')
    expect(SORT_MENU_LABEL.name).toBe('Name')
  })
})

describe('stampFor', () => {
  it('reads the sorted stamp, falling back to the modified time under the name sort', () => {
    const entry = map('x', { modifiedAt: 7, createdAt: 3 })
    expect(stampFor(entry, 'createdAt')).toBe(3)
    expect(stampFor(entry, 'name')).toBe(7)
    expect(stampFor(entry, 'openedAt')).toBeUndefined()
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000
  const ago = (seconds: number) => relativeTime(now - seconds * 1000, now)

  it('rounds the youngest stamps to just now', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(44)).toBe('just now')
  })

  it('steps through seconds, minutes, hours, days and weeks', () => {
    expect(ago(50)).toBe('50s ago')
    expect(ago(60)).toBe('1m ago')
    expect(ago(3599)).toBe('59m ago')
    expect(ago(3600)).toBe('1h ago')
    expect(ago(86400 * 3)).toBe('3d ago')
    expect(ago(604800 * 2)).toBe('2w ago')
  })
})
