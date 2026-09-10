// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from '../ImportDialog'
import { StoreProvider } from '../store'

describe('screenshot dialog native lifecycle', () => {
  let root: Root
  let container: HTMLDivElement
  const close = vi.fn()
  const showModal = vi.fn()
  const closeModal = vi.fn()
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

    // jsdom has no dialog implementation. Chromium covers focus and Escape.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: showModal },
      close: { configurable: true, value: closeModal },
    })
    showModal.mockClear()
    closeModal.mockClear()
    localStorage.clear()
    sessionStorage.clear()
    close.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<StoreProvider><ImportDialog onClose={close} /></StoreProvider>))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.unstubAllGlobals()
  })
  it('opens a native modal and closes it before removal', () => {
    expect(container.querySelector('dialog')).not.toBeNull()
    expect(showModal).toHaveBeenCalledOnce()
    act(() => root.render(null))
    expect(closeModal).toHaveBeenCalledOnce()
  })
  it('handles the native cancel event used by Escape', () => {
    const dialog = container.querySelector('dialog')!
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(close).toHaveBeenCalledOnce()
  })
})
