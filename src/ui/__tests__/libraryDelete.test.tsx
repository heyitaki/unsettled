// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { MAPS_KEY } from '../../persistence/localStorage'
import { StoreProvider } from '../store'
import { useLibrary } from '../useLibrary'

const stored = () => JSON.parse(localStorage.getItem(MAPS_KEY) ?? '[]') as { tag: string }[]

// Mounts the store over a hand-written library and hands the test the live hook.
function withLibrary(entries: unknown[], run: (library: () => ReturnType<typeof useLibrary>) => void) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(MAPS_KEY, JSON.stringify(entries))
  let library: ReturnType<typeof useLibrary> | undefined
  function Capture() {
    const current = useLibrary()
    useEffect(() => { library = current })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<StoreProvider><Capture /></StoreProvider>))
  try {
    run(() => {
      if (!library) throw new Error('Provider did not render')
      return library
    })
  } finally { act(() => root.unmount()) }
}

it('refuses a positional delete from a stale listing, then deletes once the list has caught up', () => {
  // Two entries in the pre-Game shape that nothing but their position tells apart.
  const old = (tag: string) => ({ name: 'old', board: createBoard('standard4'), tag })
  withLibrary([old('first'), old('second')], (library) => {
    const first = library().listed.maps[0]
    expect(first).toMatchObject({ id: null, index: 0, name: 'old' })
    // Another document deletes the first row; this one has not re-listed yet,
    // and the row now at that position answers to the same name.
    localStorage.setItem(MAPS_KEY, JSON.stringify([old('second')]))
    act(() => library().deleteSavedMap(first))
    expect(stored().map((entry) => entry.tag)).toEqual(['second'])
    const caughtUp = library().listed.maps[0]
    act(() => library().deleteSavedMap(caughtUp))
    expect(stored()).toEqual([])
  })
})

it('deletes a nameless row itself, not the real map whose id it repeats', () => {
  const game = newGame(createBoard('standard4'))
  withLibrary([{ id: 'shared', name: 'real', game, tag: 'real' }, { id: 'shared', game: 'junk', tag: 'junk' }], (library) => {
    const junk = library().listed.maps[1]
    expect(junk).toMatchObject({ id: 'shared', synthetic: true })
    act(() => library().deleteSavedMap(junk))
    expect(stored().map((entry) => entry.tag)).toEqual(['real'])
  })
})
