// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from '../ImportDialog'
import { StoreProvider } from '../store'

describe('screenshot dialog keyboard controls', () => {
  let root: Root
  let container: HTMLDivElement
  let opener: HTMLButtonElement
  const close = vi.fn()
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    localStorage.clear()
    sessionStorage.clear()
    close.mockClear()
    container = document.createElement('div')
    opener = document.createElement('button')
    document.body.append(opener, container)
    opener.focus()
    root = createRoot(container)
    act(() => root.render(<StoreProvider><ImportDialog onClose={close} /></StoreProvider>))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    opener.remove()
    vi.unstubAllGlobals()
  })
  it('moves focus inside and wraps Tab in both directions', () => {
    const input = container.querySelector('input')!
    const done = container.querySelector('.confirm-actions button') as HTMLButtonElement
    expect(document.activeElement).toBe(input)
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement).toBe(done)
    act(() => done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(input)
  })
  it('closes with Escape and restores focus to the trigger', () => {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledOnce()
    act(() => root.render(null))
    expect(document.activeElement).toBe(opener)
  })
})
