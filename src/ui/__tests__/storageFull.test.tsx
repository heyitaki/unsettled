// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { setTile } from '../../model/__tests__/helpers'
import * as storage from '../../persistence/localStorage'
import { CLEANUP_AGE } from '../../persistence/storageCleanup'
import { GlobalNotice } from '../GlobalNotice'
import { createLibraryAutosave } from '../libraryAutosave'
import { relativeTime } from '../library'
import { activeTab, StoreProvider, useSaveRecovery, useStore, type TabState } from '../store'
import { useLibrary } from '../useLibrary'

const NOW = 400 * 24 * 60 * 60 * 1000
const quota = () => new DOMException('Storage full', 'QuotaExceededError')
const game = newGame(createBoard('standard4'))
const entry = (id: string, age: number) => ({
  id, name: id, game, createdAt: NOW - age, modifiedAt: NOW - age, openedAt: NOW - age,
})

describe('storage full recovery', () => {
  let root: Root
  let container: HTMLDivElement
  let store: ReturnType<typeof useStore>
  let recovery: ReturnType<typeof useSaveRecovery>
  let library: ReturnType<typeof useLibrary>
  const dialog = () => container.querySelector('dialog')
  const checkboxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
  const button = (label: string | RegExp) => {
    const match = [...container.querySelectorAll('button')].find(({ textContent }) =>
      typeof label === 'string' ? textContent === label : label.test(textContent ?? ''))
    if (!match) throw new Error(`Missing button ${label}`)
    return match
  }
  const click = (label: string | RegExp) => act(() => button(label).click())
  function Capture() {
    const current = useStore()
    const saving = useSaveRecovery()
    const listed = useLibrary()
    useEffect(() => { store = current; recovery = saving; library = listed })
    return null
  }
  const mount = (noticeKey = 'desktop') => act(() => root.render(
    <StoreProvider><Capture /><GlobalNotice key={noticeKey} /></StoreProvider>,
  ))
  const edit = () => act(() => store.dispatch({
    type: 'commit', board: setTile(activeTab(store.state).game.board, { q: 0, r: 0 }, 'wheat', 6),
  }))
  const flush = () => act(() => vi.advanceTimersByTime(500))
  const refuse = (error: Error = quota()) => {
    const original = Storage.prototype.setItem
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.MAPS_KEY) throw error
      original.call(this, key, value)
    })
  }

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(storage.MAPS_KEY, JSON.stringify([
      entry('oldest', 3 * CLEANUP_AGE), entry('old', CLEANUP_AGE), entry('recent', 1000),
    ]))
    localStorage.setItem(storage.ANALYSIS_CACHE_KEY, 'cached analysis')
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value() {} },
      close: { configurable: true, value() {} },
    })
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.restoreAllMocks()
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('opens only after removing the analysis cache and a new quota failure from the retry', () => {
    mount()
    const original = Storage.prototype.setItem
    const attempts: (string | null)[] = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.MAPS_KEY) {
        expect(dialog()).toBeNull()
        attempts.push(localStorage.getItem(storage.ANALYSIS_CACHE_KEY))
        throw quota()
      }
      original.call(this, key, value)
    })
    edit()
    flush()
    expect(attempts).toEqual(['cached analysis', null])
    expect(dialog()?.getAttribute('aria-label')).toBe('Storage is full')
    expect(Object.values(recovery.failures)[0].quota).toBe(true)
  })

  it('does not prompt or clear the cache for non-quota failures', () => {
    mount()
    refuse(new DOMException('Blocked', 'SecurityError'))
    edit()
    flush()
    expect(dialog()).toBeNull()
    expect(localStorage.getItem(storage.ANALYSIS_CACHE_KEY)).toBe('cached analysis')
    expect(container.querySelector('.save-failure')?.textContent).toContain('Could not save')
    expect(container.textContent).not.toContain('Delete or export old games to make room.')
  })

  it('does not prompt when clearing the cache lets the retry save', () => {
    mount()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.MAPS_KEY && localStorage.getItem(storage.ANALYSIS_CACHE_KEY)) throw quota()
      original.call(this, key, value)
    })
    edit()
    flush()
    expect(dialog()).toBeNull()
    expect(recovery.failures).toEqual({})
    expect(storage.listMaps().maps).toHaveLength(4)
  })

  it('also handles workspace quota failures', () => {
    mount()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.WORKSPACE_KEY) throw quota()
      original.call(this, key, value)
    })
    flush()
    expect(recovery.failures.workspace.quota).toBe(true)
    expect(dialog()).not.toBeNull()
    expect(localStorage.getItem(storage.ANALYSIS_CACHE_KEY)).toBeNull()
  })

  it('waits for a deferred retry instead of prompting from the old workspace failure', () => {
    mount()
    vi.spyOn(storage, 'saveWorkspaceBlob').mockImplementationOnce(() => {
      localStorage.setItem(storage.WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'other', title: 'Other', game }] }))
      return { ok: false, error: 'Storage full', quota: true }
    })
    flush()
    expect(recovery.failures.workspace.quota).toBe(true)
    expect(localStorage.getItem(storage.ANALYSIS_CACHE_KEY)).toBeNull()
    expect(dialog()).toBeNull()
    act(() => vi.advanceTimersByTime(50))
    expect(recovery.failures).toEqual({})
    expect(dialog()).toBeNull()
  })

  it('shows preselection, relative times and checked sizes, disabling an empty selection', () => {
    mount()
    refuse()
    edit()
    flush()
    expect(checkboxes().map((input) => input.checked)).toEqual([true, true, false])
    expect(dialog()?.textContent).toContain(`Used ${relativeTime(NOW - 3 * CLEANUP_AGE, NOW)}`)
    const bytes = JSON.stringify(entry('oldest', 3 * CLEANUP_AGE)).length
      + JSON.stringify(entry('old', CLEANUP_AGE)).length
    expect(button(`Delete 2 games · ${Math.ceil(bytes / 1024)} KB`).disabled).toBe(false)
    act(() => checkboxes()[0].click())
    expect(button(/^Delete 1 game · \d+ KB$/).disabled).toBe(false)
    act(() => checkboxes()[1].click())
    expect(button('Delete 0 games · 0 KB').disabled).toBe(true)
  })

  it('deletes checked ids, refreshes the library and retries in that order', () => {
    mount()
    const original = Storage.prototype.setItem
    const operations: string[] = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.MAPS_KEY) {
        const maps = JSON.parse(value) as { id: string }[]
        if (maps.length > 2) throw quota()
        operations.push(maps.map(({ id }) => id).join(','))
      }
      original.call(this, key, value)
    })
    edit()
    flush()
    const revision = store.state.mapsRevision
    const deleted = vi.spyOn(storage, 'deleteMaps')
    click(/^Delete 2 games/)
    expect(deleted).toHaveBeenCalledExactlyOnceWith(['oldest', 'old'])
    expect(operations[0]).toBe('recent')
    expect(operations[1].split(',')).toHaveLength(2)
    expect(store.state.mapsRevision).toBeGreaterThan(revision)
    expect(library.listed.maps.map(({ name }) => name)).toEqual(['recent', 'Board 1'])
    expect(recovery.failures).toEqual({})
    expect(dialog()).toBeNull()
    expect(container.querySelector('.save-failure')).toBeNull()
  })

  it('reopens after deletion with the remaining candidates and fresh preselection if saving still fails', () => {
    mount()
    const write = refuse()
    edit()
    flush()
    write.mockRestore()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === storage.MAPS_KEY && (JSON.parse(value) as unknown[]).length > 1) throw quota()
      original.call(this, key, value)
    })
    click(/^Delete 2 games/)
    expect(dialog()).not.toBeNull()
    expect(checkboxes()).toHaveLength(1)
    expect(checkboxes()[0].checked).toBe(true)
    expect(dialog()?.textContent).toContain('recent')
    expect(button(/^Delete 1 game/).disabled).toBe(false)
  })

  it('keeps Not now closed through retries and a shell remount until quota failures clear', () => {
    mount()
    const write = refuse()
    edit()
    flush()
    click('Not now')
    click('Retry saving')
    mount('phone')
    expect(dialog()).toBeNull()
    expect(container.querySelector('.save-failure')).not.toBeNull()
    write.mockRestore()
    click('Retry saving')
    expect(recovery.failures).toEqual({})
    refuse()
    act(() => store.dispatch({
      type: 'commit', board: setTile(activeTab(store.state).game.board, { q: 0, r: 0 }, 'ore', 8),
    }))
    flush()
    expect(dialog()).not.toBeNull()
    expect(checkboxes().map((input) => input.checked)).toEqual([true, true, false])
  })

  it('protects both local and stored tab links and adds the no-candidates toast line', () => {
    localStorage.setItem(storage.MAPS_KEY, JSON.stringify([entry('here', CLEANUP_AGE), entry('there', CLEANUP_AGE)]))
    mount()
    act(() => store.dispatch({ type: 'tab-add', title: 'here', game, mapId: 'here' }))
    localStorage.setItem(storage.WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'there-tab', title: 'there', game, mapId: 'there' }] }))
    refuse()
    edit()
    flush()
    expect(dialog()).toBeNull()
    expect(container.querySelector('.save-failure')?.textContent).toContain('Delete or export old games to make room.')
    expect(storage.listMaps().maps).toHaveLength(2)
  })

  it('keeps checked games and shows the error when deletion fails', () => {
    mount()
    refuse()
    edit()
    flush()
    click(/^Delete 2 games/)
    expect(storage.listMaps().maps).toHaveLength(3)
    expect(dialog()?.querySelector('[role=alert]')?.textContent).toBe('Unable to write localStorage')
    expect(checkboxes().map((input) => input.checked)).toEqual([true, true, false])
  })

  it('does not delete a candidate another window has opened while the prompt was showing', () => {
    mount()
    const write = refuse()
    edit()
    flush()
    write.mockRestore()
    localStorage.setItem(storage.WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'other', title: 'oldest', game, mapId: 'oldest' }] }))
    const deleted = vi.spyOn(storage, 'deleteMaps')
    click(/^Delete 2 games/)
    expect(deleted).toHaveBeenCalledExactlyOnceWith(['old'])
    expect(storage.listMaps().maps.map(({ id }) => id)).toContain('oldest')
  })

  it('preserves a closed rescue quota flag when another tab saves its map', () => {
    const linked: TabState = {
      id: 'closed', title: 'old', game, mapId: 'old', activePlayerId: null, past: [], future: [],
    }
    const report = vi.fn()
    const autosave = createLibraryAutosave(vi.fn(), [linked], 500, report)
    try {
      const write = refuse()
      autosave.arm([{ ...linked, game: newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6)) }])
      autosave.arm([])
      write.mockRestore()
      const reopened = { ...linked, id: 'reopened' }
      autosave.arm([reopened])
      autosave.arm([{ ...reopened, game: newGame(setTile(game.board, { q: 0, r: 0 }, 'ore', 8)) }])
      vi.advanceTimersByTime(500)
      expect(report).toHaveBeenLastCalledWith('library:closed', expect.objectContaining({
        quota: true, message: expect.stringContaining('separate board'),
      }))
    } finally { autosave.dispose() }
  })
})

it('recognizes quota DOMExceptions by name or legacy code, without treating other errors as quota', () => {
  for (const name of ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']) {
    expect(storage.isQuotaError(new DOMException('full', name))).toBe(true)
  }
  for (const code of [22, 1014]) {
    const error = new DOMException('full')
    Object.defineProperty(error, 'code', { value: code })
    expect(storage.isQuotaError(error)).toBe(true)
  }
  for (const error of [new DOMException('blocked', 'SecurityError'), new Error('QuotaExceededError'), null, { code: 22 }]) {
    expect(storage.isQuotaError(error)).toBe(false)
  }
})
