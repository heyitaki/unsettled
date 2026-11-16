// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { restoreLibraryBackup } from '../backup'
import { MAPS_KEY, PEOPLE_KEY } from '../localStorage'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('writes no boards when saving the merged people list fails', () => {
  const setItem = Storage.prototype.setItem
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === PEOPLE_KEY) throw new DOMException('People storage full', 'QuotaExceededError')
    setItem.call(this, key, value)
  })
  const result = restoreLibraryBackup({
    format: 'unsettled-library', version: 1,
    maps: [{ id: 'incoming', name: 'Incoming board', game: newGame(createBoard('standard4')) }],
    people: [{ name: 'alice', prints: ['123456'.repeat(64)] }],
  })
  expect(result).toMatchObject({ ok: false })
  expect(localStorage.getItem(MAPS_KEY)).toBeNull()
  expect(write.mock.calls.some(([key]) => key === MAPS_KEY)).toBe(false)
})
