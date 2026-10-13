// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { activeTab, StoreProvider, useStore } from '../store'
import { useDraftSteps } from '../useDraftSteps'

type Seen = ReturnType<typeof useStore> & ReturnType<typeof useDraftSteps>

function Capture({ report }: { report(value: Seen): void }) {
  const store = useStore()
  const steps = useDraftSteps()
  useEffect(() => report({ ...store, ...steps }), [store, steps, report])
  return null
}

it('discards forward picks when undoing a claim even though the piece arrays are unchanged', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  const root = createRoot(document.createElement('div'))
  let seen: Seen
  const tab = () => activeTab(seen.state)
  try {
    await act(async () => root.render(<StoreProvider><Capture report={(value) => { seen = value }} /></StoreProvider>))
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' })
    await act(async () => seen.dispatch({ type: 'commit', board: placeBuilding(board, boardGrid(board.layout).vertexIds[0], 'aki', 'settlement') }))
    await act(async () => seen.stepBack())
    expect(seen!.canStepForward).toBe(true)
    const stepped = tab().game.board
    await act(async () => seen.dispatch({ type: 'commit', board: setMe(stepped, 'b') }))
    expect(seen!.canStepForward).toBe(true)
    await act(async () => seen.dispatch({ type: 'undo' }))
    expect(tab().game.board.buildings).toBe(stepped.buildings)
    expect(tab().game.board.roads).toBe(stepped.roads)
    expect(tab().future).toHaveLength(1)
    expect(seen!.canStepForward).toBe(false)
    await act(async () => seen.dispatch({ type: 'redo' }))
    expect(tab().future).toHaveLength(0)
    expect(seen!.canStepForward).toBe(false)
  } finally {
    act(() => root.unmount())
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  }
})
