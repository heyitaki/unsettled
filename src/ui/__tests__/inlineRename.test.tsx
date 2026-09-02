// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineRename } from '../InlineRename'

let container: HTMLDivElement
let root: Root

// React's act() refuses to run without this flag, and jsdom does not set it.
const actEnvironment = (on: boolean): void => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', on)
}

const noop = (): void => {}

type Props = Parameters<typeof InlineRename>[0]

const draw = (props: Partial<Props> = {}): void => {
  act(() => {
    root.render(
      <InlineRename
        name="Board 1"
        draft={null}
        onDraft={noop}
        onStart={noop}
        onCommit={noop}
        onCancel={noop}
        {...props}
      />,
    )
  })
}

const field = (): HTMLInputElement => {
  const input = container.querySelector('input')
  if (!input) throw new Error('no rename field')
  return input
}

const press = (key: string): void => {
  const input = field()
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

// The real gesture: React listens for the focusout that blurring a focused
// field fires, not for a synthesised blur.
const blur = (): void => {
  const input = field()
  act(() => input.blur())
}

describe('InlineRename', () => {
  beforeEach(() => {
    actEnvironment(true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    actEnvironment(false)
  })

  it('renders the name as a button at rest', () => {
    draw()

    const button = container.querySelector('button.list-row-name')
    expect(button?.textContent).toBe('Board 1')
    expect(container.querySelector('input')).toBeNull()
  })

  it('renders plain text when the name cannot be renamed', () => {
    draw({ onStart: undefined })

    expect(container.querySelector('button')).toBeNull()
    const plain = container.querySelector('.list-row-name.plain')
    expect(plain?.tagName).toBe('SPAN')
    expect(plain?.textContent).toBe('Board 1')
  })

  it('focuses the field while renaming', () => {
    draw({ draft: 'Harbour' })

    const input = container.querySelector<HTMLInputElement>('input.list-row-rename')
    expect(input?.value).toBe('Harbour')
    expect(document.activeElement).toBe(input)
  })

  it('commits on Enter', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    draw({ draft: 'Harbour', onCommit, onCancel })

    press('Enter')

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('commits on blur, which is how a rename ends when the row is clicked away from', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    draw({ draft: 'Harbour', onCommit, onCancel })

    blur()

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('commits once when Enter is followed by the blur the unmount fires', () => {
    const onCommit = vi.fn()
    draw({ draft: 'Harbour', onCommit })

    press('Enter')
    blur()

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not commit the blur that follows an Escape', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    draw({ draft: 'Harbour', onCommit, onCancel })

    press('Escape')
    blur()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('reverts on Escape', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    draw({ draft: 'Harbour', onCommit, onCancel })

    press('Escape')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
