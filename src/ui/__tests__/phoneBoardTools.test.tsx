// @vitest-environment jsdom
import { act, useEffect, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer } from '../../model/board'
import { useBoardActions } from '../boardActions'
import { BoardTools } from '../BoardTools'
import { PhoneHeader } from '../phone/PhoneHeader'
import { activeTab, StoreProvider, useStore } from '../store'

type Store = ReturnType<typeof useStore>
function Capture({ report }: { report(store: Store): void }) {
  const store = useStore()
  useEffect(() => report(store), [store, report])
  return null
}

function PhoneTools({ building, onOpen }: { building: boolean; onOpen: ComponentProps<typeof PhoneHeader>['onOpen'] }) {
  const { state, dispatch } = useStore()
  const actions = useBoardActions(activeTab(state), dispatch)
  return <>
    <PhoneHeader building={building} onToggleMode={() => {}} onOpen={onOpen} />
    {building && <BoardTools className="phone-block phone-block-flush phone-build" actions={actions} onDone={() => {}} onCancel={() => {}} />}
    {actions.confirm}
  </>
}

describe('Phone board tools', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Store
  const onOpen = vi.fn()
  const render = async (building: boolean) => {
    await act(async () => root.render(<StoreProvider>
      <Capture report={(store) => { seen = store }} />
      <PhoneTools building={building} onOpen={onOpen} />
    </StoreProvider>))
  }
  const buttons = (prefix: string) => [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
    .filter((item) => item.getAttribute('aria-label')!.startsWith(prefix))
  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    onOpen.mockClear()
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value() {} },
      close: { configurable: true, value() {} },
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
    })
    container = document.createElement('div')
    root = createRoot(container)
    await render(false)
    await act(async () => seen.dispatch({ type: 'commit', board: addPlayer(activeTab(seen.state).game.board, { id: 'blue', name: 'Blue', color: '#3063ba' }) }))
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('opens Players from one pill outside build mode, with the claim ringed', async () => {
    expect(buttons('Players')).toHaveLength(1)
    expect(buttons('Place pieces for')).toHaveLength(0)
    expect(buttons('Players')[0].getAttribute('aria-haspopup')).toBe('dialog')
    expect(container.querySelectorAll('.head-dot')).toHaveLength(2)
    expect(container.querySelector('.head-dot')?.classList.contains('me')).toBe(true)
    await act(async () => buttons('Players')[0].click())
    expect(onOpen).toHaveBeenCalledWith('players')
  })

  it('selects the brush from roster dots in build mode and keeps Players available', async () => {
    await render(true)
    expect(container.querySelector('.head-dots')?.tagName).toBe('DIV')
    expect(buttons('Place pieces for').map((item) => item.getAttribute('aria-label')))
      .toEqual(['Place pieces for aki', 'Place pieces for Blue'])
    expect(buttons('Place pieces for').map((item) => item.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    await act(async () => buttons('Place pieces for Blue')[0].click())
    expect(activeTab(seen.state).activePlayerId).toBe('blue')
    expect(buttons('Place pieces for').map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(buttons('Place pieces for Blue')[0].querySelector('.head-dot.me')).not.toBeNull()
    expect(activeTab(seen.state).game.board.mePlayerId).toBe('aki')
    await act(async () => buttons('Players')[0].click())
    expect(onOpen).toHaveBeenCalledWith('players')
    await render(false)
    expect(buttons('Place pieces for')).toHaveLength(0)
    expect(container.querySelector('.head-dot')?.classList.contains('me')).toBe(true)
  })

  it('puts only Undo and Redo in the build heading without a Player row', async () => {
    await render(true)
    expect([...container.querySelectorAll('.phone-build .tool-label')].map((label) => label.firstChild?.textContent))
      .toEqual(['Layout', 'Terrain', 'Number token', 'Board'])
    expect([...container.querySelectorAll('.panel-heading button')].map((item) => item.getAttribute('aria-label')))
      .toEqual(['Undo', 'Redo'])
  })

  it('can randomize an untouched deal again after reopening build mode', async () => {
    const randomize = () => [...container.querySelectorAll<HTMLButtonElement>('.structure-grid button')].find((item) => item.textContent === 'Randomize')!
    await render(true)
    await act(async () => randomize().click())
    const before = activeTab(seen.state)
    await render(false)
    await render(true)
    await act(async () => randomize().click())
    expect(container.querySelector('dialog')).toBeNull()
    expect(activeTab(seen.state).past).toHaveLength(before.past.length + 1)
  })
})
