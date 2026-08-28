import { useCallback, useSyncExternalStore } from 'react'

// getSnapshot runs on every render of every consumer, including each pointermove
// of a board drag, so the MediaQueryList is built once per query rather than per
// call.
const lists = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return null
  const cached = lists.get(query)
  if (cached) return cached
  const media = window.matchMedia(query)
  lists.set(query, media)
  return media
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const media = listFor(query)
    if (!media) return () => {}
    media.addEventListener('change', notify)
    return () => media.removeEventListener('change', notify)
  }, [query])
  const snapshot = useCallback(() => listFor(query)?.matches ?? false, [query])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

export const useCoarsePointer = (): boolean => useMediaQuery('(pointer: coarse)')
