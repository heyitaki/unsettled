// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { setTile } from '../../model/__tests__/helpers'
import { MAPS_KEY, WORKSPACE_KEY, listMaps } from '../../persistence/localStorage'
import { activeTab, StoreProvider, useStore, useSaveRecovery } from '../store'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('keeps storage failures visible and retries both stores without another edit', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
  let store: ReturnType<typeof useStore> | undefined
  let recovery: ReturnType<typeof useSaveRecovery> | undefined
  function Capture() {
    const current = useStore()
    const saving = useSaveRecovery()
    useEffect(() => { store = current; recovery = saving })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<StoreProvider><Capture /></StoreProvider>))
  if (!store || !recovery) throw new Error('Provider did not render')
  const original = Storage.prototype.setItem
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === MAPS_KEY || key === WORKSPACE_KEY) throw new Error('Quota exceeded')
    original.call(this, key, value)
  })
  try {
    const { dispatch, state } = store
    act(() => dispatch({ type: 'commit', board: setTile(activeTab(state).game.board, { q: 0, r: 0 }, 'wheat', 6) }))
    act(() => vi.advanceTimersByTime(1000))
    expect(Object.keys(recovery.failures)).toHaveLength(2)
    act(() => vi.advanceTimersByTime(10000))
    expect(Object.keys(recovery.failures)).toHaveLength(2)
    write.mockRestore()
    act(() => recovery?.retry())
    expect(Object.keys(recovery.failures)).toHaveLength(0)
    expect(listMaps().maps).toHaveLength(1)
  } finally { act(() => root.unmount()) }
})
