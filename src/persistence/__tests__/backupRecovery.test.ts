// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame } from '../../model/game'
import { createLibraryBackup } from '../backup'

afterEach(() => vi.restoreAllMocks())

it('still exports in-memory games when browser storage cannot be read', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied') })
  const game = newGame(setTile(createBoard('standard4'), { q: 0, r: 0 }, 'wheat', 6))
  const backup = JSON.parse(createLibraryBackup([{ id: 'open', title: 'Open', game }]))
  expect(backup.maps).toEqual([{ id: 'open', name: 'Open', game }])
  expect(Object.values(backup.recovery)).toContain('Storage denied')
})
