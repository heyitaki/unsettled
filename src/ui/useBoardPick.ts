import { useEffect, useRef } from 'react'
import { revealBoardIfScrolledPast } from './revealBoard'
import { useStore, type BoardPick, type PickTarget } from './store'

export function useBoardPick(target: PickTarget | null, consume: (ref: string) => void) {
  const { state, dispatch } = useStore()
  const consumed = useRef<BoardPick | null>(null)
  useEffect(() => () => dispatch({ type: 'pick-clear' }), [dispatch])
  useEffect(() => {
    const pick = state.pick
    if (target === null) {
      if (pick) dispatch({ type: 'pick-clear' })
      return
    }
    const matches = pick?.want === target.want &&
      (target.want !== 'vertex' || (pick.want === 'vertex' && pick.piece === target.piece)) &&
      (target.want !== 'edge' || (pick.want === 'edge' && pick.edges === target.edges))
    if (!matches) {
      dispatch({ type: 'pick', target })
      revealBoardIfScrolledPast()
      return
    }
    if (pick.ref === undefined || consumed.current === pick) return
    consumed.current = pick
    consume(pick.ref)
    dispatch({ type: 'pick-clear' })
  }, [state.pick, target, consume, dispatch])
}
