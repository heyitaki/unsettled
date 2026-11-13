// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { MAPS_KEY, deleteMaps, listMaps, saveMap } from '../localStorage'
import { CLEANUP_AGE, CLEANUP_FALLBACK, cleanupCandidates } from '../storageCleanup'

const DAY = 24 * 60 * 60 * 1000
const NOW = 400 * DAY

// Saves `name` with every stamp at `daysAgo` days before NOW.
function saved(name: string, daysAgo: number): string {
  vi.spyOn(Date, 'now').mockReturnValue(NOW - daysAgo * DAY)
  const result = saveMap(name, newGame(createBoard('standard4')))
  vi.restoreAllMocks()
  if (!result.ok) throw new Error(result.error)
  return result.id
}

describe('cleanupCandidates', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('lists maps open in no tab, least recently used first, with their stored size', () => {
    const recent = saved('recent', 1)
    const old = saved('old', 90)
    const open = saved('open', 200)
    const { candidates } = cleanupCandidates(NOW, new Set([open]))
    expect(candidates.map((map) => map.id)).toEqual([old, recent])
    expect(candidates[0]).toMatchObject({ id: old, name: 'old', lastUsed: NOW - 90 * DAY })
    const stored = JSON.parse(localStorage.getItem(MAPS_KEY)!) as { id: string }[]
    expect(candidates[0].bytes).toBe(JSON.stringify(stored.find((entry) => entry.id === old)).length)
  })

  it('preselects every map unused for the cleanup age', () => {
    expect(CLEANUP_AGE).toBe(30 * DAY)
    const ids = [saved('a', 120), saved('b', 31), saved('c', 30), saved('d', 29), saved('e', 2)]
    expect(cleanupCandidates(NOW, new Set()).preselected).toEqual(ids.slice(0, 3))
  })

  it('falls back to the least recently used maps when none is old enough', () => {
    expect(CLEANUP_FALLBACK).toBe(5)
    const ids = Array.from({ length: 7 }, (_, i) => saved(`m${i}`, 10 - i))
    expect(cleanupCandidates(NOW, new Set()).preselected).toEqual(ids.slice(0, CLEANUP_FALLBACK))
  })

  it('treats a map with no stamps as the coldest, and skips entries with no usable id', () => {
    const stamped = saved('stamped', 1)
    const stored = JSON.parse(localStorage.getItem(MAPS_KEY)!) as Record<string, unknown>[]
    const legacy: Record<string, unknown> = { ...stored[0], id: 'legacy', name: 'legacy' }
    delete legacy.createdAt
    delete legacy.modifiedAt
    delete legacy.openedAt
    const nameless = { ...stored[0], id: '', name: 'no id' }
    localStorage.setItem(MAPS_KEY, JSON.stringify([...stored, legacy, nameless]))
    const { candidates, preselected } = cleanupCandidates(NOW, new Set())
    expect(candidates.map((map) => map.id)).toEqual(['legacy', stamped])
    expect(candidates[0].lastUsed).toBeNull()
    expect(preselected).toEqual(['legacy'])
  })

  it('offers nothing when every map is open', () => {
    const id = saved('only', 100)
    expect(cleanupCandidates(NOW, new Set([id]))).toEqual({ candidates: [], preselected: [] })
  })
})

describe('deleteMaps', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('deletes many maps in one write and ignores unknown ids', () => {
    const [a, b, c] = [saved('a', 3), saved('b', 2), saved('c', 1)]
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(deleteMaps([a, c, 'missing'])).toEqual({ ok: true })
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(listMaps().maps.map((map) => map.id)).toEqual([b])
  })

  it('skips the write when nothing matches', () => {
    saved('a', 1)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(deleteMaps(['missing'])).toEqual({ ok: true })
    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('quota failures', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it.each([
    new DOMException('full', 'QuotaExceededError'),
    new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'),
  ])('flags a write the browser refused for space (%s)', (error) => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw error })
    expect(saveMap('map', newGame(createBoard('standard4')))).toMatchObject({ ok: false, quota: true })
  })

  it('does not flag other write failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('denied', 'SecurityError') })
    const result = saveMap('map', newGame(createBoard('standard4')))
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('quota')
  })
})
