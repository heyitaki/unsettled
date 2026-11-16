// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Person } from '../../model/people'
import { createLibraryBackup, restoreLibraryBackup } from '../backup'
import { loadPeople, MIRRORED_KEYS, PEOPLE_KEY, savePeople } from '../localStorage'

const print = (value: number) => value.toString(16).padStart(2, '0').repeat(192)
const alice: Person = { name: 'alice', prints: [print(10)] }
const bob: Person = { name: 'bob', prints: [print(120)] }

beforeEach(() => localStorage.clear())

describe('people list', () => {
  it('starts empty and round-trips', () => {
    expect(loadPeople()).toEqual([])
    savePeople([alice, bob])
    expect(loadPeople()).toEqual([alice, bob])
  })

  it('is mirrored to phone storage', () => {
    expect(MIRRORED_KEYS).toContain(PEOPLE_KEY)
  })

  it('keeps a corrupt blob instead of discarding it', () => {
    localStorage.setItem(PEOPLE_KEY, '{not json')
    expect(loadPeople()).toEqual([])
    savePeople([alice])
    expect(localStorage.getItem(`${PEOPLE_KEY}.corrupt`)).toBe('{not json')
    expect(loadPeople()).toEqual([alice])
  })

  it('rejects malformed entries and duplicate names', () => {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify([alice, { name: 'ALICE', prints: [print(30)] }]))
    expect(loadPeople()).toEqual([])
    localStorage.setItem(PEOPLE_KEY, JSON.stringify([{ name: 'x', prints: ['zz'] }]))
    expect(loadPeople()).toEqual([])
  })
})

describe('people in a library backup', () => {
  it('exports the list and merges it back by name', () => {
    savePeople([alice])
    const backup = createLibraryBackup([])
    savePeople([{ name: 'Alice', prints: [print(50)] }, bob])
    expect(restoreLibraryBackup(backup)).toEqual({ ok: true, count: 0 })
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [print(50), print(10)] }, bob])
  })

  it('restores an older backup without a list', () => {
    savePeople([alice])
    const backup = JSON.parse(createLibraryBackup([]))
    delete backup.people
    expect(restoreLibraryBackup(backup)).toEqual({ ok: true, count: 0 })
    expect(loadPeople()).toEqual([alice])
  })
})
