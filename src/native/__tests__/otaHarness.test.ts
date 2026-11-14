import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { libraryDigest } from '../otaHarness'

vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: {} }))
vi.mock('@capacitor/app', () => ({ App: {} }))

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('libraryDigest', () => {
  it('hashes each entry without its timestamp fields, keys in stored order', async () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'First', createdAt: 1, board: { x: 1 }, modifiedAt: 2, openedAt: 3 },
      { name: 'No id', board: {} },
    ])
    expect(await libraryDigest(raw)).toEqual([
      { id: 'a', name: 'First', hash: sha('{"id":"a","name":"First","board":{"x":1}}') },
      { id: null, name: 'No id', hash: sha('{"name":"No id","board":{}}') },
    ])
  })

  it('ignores timestamps when comparing two copies of one map', async () => {
    const [before] = (await libraryDigest(JSON.stringify([{ id: 'a', name: 'M', openedAt: 1 }])))!
    const [after] = (await libraryDigest(JSON.stringify([{ id: 'a', name: 'M', openedAt: 9, modifiedAt: 9 }])))!
    expect(after).toEqual(before)
  })

  it('is null for a missing, corrupt or non-array library', async () => {
    expect(await libraryDigest(null)).toBeNull()
    expect(await libraryDigest('{')).toBeNull()
    expect(await libraryDigest('{"id":"a"}')).toBeNull()
  })
})
