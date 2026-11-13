import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

/**
 * Whether a scroller has content hidden above or below it, for edge shadows or fades. Pass `ref`
 * and `onScroll` to the scroller. It re-measures after every render of the caller (content
 * changes come through those) and when the scroller itself resizes; a caller that moves
 * `scrollTop` in its own effect calls `sync` afterwards.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const sync = useCallback(() => {
    if (!node) return
    const top = node.scrollTop > 1
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 1
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [node])
  useLayoutEffect(sync)
  useEffect(() => {
    // jsdom has no ResizeObserver; every browser the app supports does.
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, sync])
  return { ref: setNode, node, onScroll: sync, sync, ...edges }
}
