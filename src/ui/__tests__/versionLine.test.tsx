// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateOtaStatus } from '../../native/otaStatus'
import { VersionLine } from '../VersionLine'

let container: HTMLDivElement
let root: Root

// React's act() refuses to run without this flag, and jsdom does not set it.
const actEnvironment = (on: boolean): void => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', on)
}

const lines = (): string[] => [...container.querySelectorAll('p')].map((p) => p.textContent ?? '')

describe('VersionLine', () => {
  beforeEach(() => {
    actEnvironment(true)
    vi.stubEnv('MODE', 'native')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<VersionLine />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    act(() => updateOtaStatus({ bundleVersion: null, storeUpdate: false }))
    vi.unstubAllEnvs()
    actEnvironment(false)
  })

  it('renders nothing before the running label is known', () => {
    expect(container.innerHTML).toBe('')
  })

  it('shows the running label', () => {
    act(() => updateOtaStatus({ bundleVersion: '1.0.521' }))
    expect(lines()).toEqual(['Version 1.0.521'])
  })

  it('adds the App Store note while the store update is set, and drops it when cleared', () => {
    act(() => updateOtaStatus({ bundleVersion: '1.0.521', storeUpdate: true }))
    expect(lines()).toEqual(['Version 1.0.521', 'A newer version is on the App Store.'])
    act(() => updateOtaStatus({ storeUpdate: false }))
    expect(lines()).toEqual(['Version 1.0.521'])
  })

  it('shows the App Store note alone before the running label is known', () => {
    act(() => updateOtaStatus({ storeUpdate: true }))
    expect(lines()).toEqual(['A newer version is on the App Store.'])
  })

  it('renders nothing outside the native build', () => {
    vi.stubEnv('MODE', 'production')
    act(() => updateOtaStatus({ bundleVersion: '1.0.521', storeUpdate: true }))
    expect(container.innerHTML).toBe('')
  })
})
