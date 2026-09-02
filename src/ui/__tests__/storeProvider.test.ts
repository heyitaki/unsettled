// @vitest-environment jsdom
import { act, createElement, useEffect, useRef, type Dispatch } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setTile } from '../../model/board'
import { listMaps } from '../../persistence/localStorage'
import { activeTab, StoreProvider, useStore, type StoreAction, type StoreState } from '../store'

type Seen = { state: StoreState; dispatch: Dispatch<StoreAction> }

// The page being hidden between a commit and its passive effects. The browser
// delivers pagehide and visibilitychange at task boundaries, and the commit's
// passive phase is a separate task from the commit whenever the render was not
// a discrete event's; a child's passive effect stands in for that moment, since
// it runs before the provider's own passive effects and after its layout ones.
function HideAfterEdit({ onRender }: { onRender: (seen: Seen) => void }) {
  const { state, dispatch } = useStore()
  const mounted = useRef(state.tabs)
  const hidden = useRef(false)
  useEffect(() => {
    onRender({ state, dispatch })
    if (state.tabs === mounted.current || hidden.current) return
    hidden.current = true
    window.dispatchEvent(new Event('pagehide'))
  }, [state, dispatch, onRender])
  return null
}

describe('StoreProvider', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    act(() => root.unmount())
  })

  it('arms the library autosave in the commit, so a page hidden before its passive effects still writes the edit', () => {
    let seen: Seen | undefined
    const onRender = (next: Seen) => {
      seen = next
    }
    act(() => root.render(createElement(StoreProvider, null, createElement(HideAfterEdit, { onRender }))))
    if (seen === undefined) throw new Error('provider never rendered')
    const tab = activeTab(seen.state)
    expect(tab.mapId).toBeNull()
    expect(listMaps().maps).toEqual([])
    const { dispatch } = seen
    act(() => dispatch({ type: 'commit', board: setTile(tab.game.board, { q: 0, r: 0 }, 'wheat', 6) }))
    // The unload flush wrote the tab and linked it; a flush that had not seen
    // the edit would leave the library empty and the tab unlinked.
    expect(listMaps().maps.map((map) => map.name)).toEqual([tab.title])
    expect(activeTab(seen.state).mapId).not.toBeNull()
  })
})
