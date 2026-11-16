// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { parseGame } from '../../model/serialization'
import { WORKSPACE_KEY } from '../../persistence/localStorage'
import { downloadBoard } from '../boardFiles'
import { activeTab, StoreProvider, useStore } from '../store'
import { useJsonFiles } from '../useJsonFiles'

vi.mock('../boardFiles', async (original) => ({
  ...await original<typeof import('../boardFiles')>(),
  downloadBoard: vi.fn(),
}))

let root: Root
let files: ReturnType<typeof useJsonFiles>
let game: Game
function Probe() {
  files = useJsonFiles()
  game = activeTab(useStore().state).game
  return null
}

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  const saved = newGame(createBoard('standard4'))
  saved.avatars = { aki: '123456'.repeat(64) }
  saved.stats.aki.handUnknown = 5
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'test', title: 'Friday', game: saved }] }))
  root = createRoot(document.createElement('div'))
  act(() => root.render(<StoreProvider><Probe /></StoreProvider>))
})

afterEach(() => act(() => root.unmount()))

it('exports a shareable game without avatars, keeping the live game and other fields intact', () => {
  act(() => files.items.find(({ label }) => label === 'Export JSON')!.onClick())
  const { avatars, ...shared } = game
  expect(downloadBoard).toHaveBeenCalledOnce()
  const [title, contents] = vi.mocked(downloadBoard).mock.calls[0]
  expect(title).toBe('Friday')
  expect(JSON.parse(contents)).toEqual(shared)
  expect(parseGame(contents)).toEqual({ ok: true, game: shared })
  expect(game.avatars).toBe(avatars)
  expect(game.avatars).toEqual({ aki: '123456'.repeat(64) })
})

it('keeps avatars in library backups', () => {
  act(() => files.items.find(({ label }) => label === 'Back up library')!.onClick())
  const [title, contents] = vi.mocked(downloadBoard).mock.calls[0]
  expect(title).toBe('unsettled-library-backup')
  expect(JSON.parse(contents).maps[0].game).toEqual(game)
})
