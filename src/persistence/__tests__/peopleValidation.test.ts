// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibraryBackup, restoreLibraryBackup } from '../backup'
import { loadPeople, MAPS_KEY, parsePeople, PEOPLE_KEY, savePeople } from '../localStorage'

const print = '123456'.repeat(64)
beforeEach(() => localStorage.clear())

it.each([
  {}, null, [{ name: '', prints: [print] }], [{ name: ' Alice ', prints: [print] }],
  [{ name: 'Alice', prints: [] }], [{ name: 'Alice', prints: ['AB'.repeat(192)] }],
  [{ name: 'Alice', prints: [`${print}\n`] }],
  [{ name: 'Alice', prints: [print], extra: true }], [{ name: 'Alice' }],
])('preserves invalid people data %j on the next save', (value) => {
  const blob = JSON.stringify(value)
  localStorage.setItem(PEOPLE_KEY, blob)
  expect(loadPeople()).toEqual([])
  expect(savePeople([{ name: 'Alice', prints: [print] }]).ok).toBe(true)
  expect(localStorage.getItem(`${PEOPLE_KEY}.corrupt`)).toBe(blob)
})

it('validates incoming people before writing any restored data', () => {
  savePeople([{ name: 'Alice', prints: [print] }])
  const before = localStorage.getItem(PEOPLE_KEY)
  const backup = JSON.parse(createLibraryBackup([]))
  backup.people = [{ name: 'Bob', prints: ['invalid'] }]
  expect(restoreLibraryBackup(backup).ok).toBe(false)
  expect(localStorage.getItem(PEOPLE_KEY)).toBe(before)
  expect(localStorage.getItem(MAPS_KEY)).toBeNull()
})

it('unions prints in stored order and is idempotent across repeated restores', () => {
  savePeople([{ name: 'alice', prints: [print, 'abcdef'.repeat(64)] }])
  const backup = createLibraryBackup([])
  savePeople([{ name: 'Alice', prints: ['abcdef'.repeat(64)] }])
  expect(restoreLibraryBackup(backup).ok).toBe(true)
  expect(restoreLibraryBackup(backup).ok).toBe(true)
  expect(loadPeople()).toEqual([{ name: 'Alice', prints: ['abcdef'.repeat(64), print] }])
})

it('reports storage write failures', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
  try {
    expect(savePeople([{ name: 'Alice', prints: [print] }])).toMatchObject({ ok: false, quota: true })
  } finally { write.mockRestore() }
})

describe('default names in the people list', () => {
  it('rejects a person named like a default player', () => {
    expect(parsePeople([{ name: 'Red', prints: [print] }])).toBeNull()
    expect(parsePeople([{ name: 'Player 2', prints: [print] }])).toBeNull()
    expect(parsePeople([{ name: 'aki', prints: [print] }])).toEqual([{ name: 'aki', prints: [print] }])
  })
})
