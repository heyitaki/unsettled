import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { dropIndexFor, edgeScrollStep, rowShift, type RowBox } from './rowDrag'

/** How long a finger must rest on a row before it becomes a drag. */
export const HOLD_MS = 380
/** Movement before the hold completes that means "this was a scroll". */
export const HOLD_SLOP = 8

/**
 * What a row drag is currently aimed at: a destination row, or the trash. One
 * value rather than a pair, since aiming at a row and at the trash are mutually
 * exclusive and every writer would otherwise have to remember to clear the
 * other.
 */
export type DropTarget = { kind: 'row'; index: number } | { kind: 'trash' }

export interface RowReorderOptions {
  /** Coarse pointers hold to lift a row; fine ones use native HTML5 drag. */
  coarse: boolean
  /** Row ids in list order; a drop index is a position in this list. */
  ids: readonly string[]
  /** Select the rows, and the trash row, inside the list element. */
  rowSelector: string
  trashSelector: string
  /** A row that must stay put, such as one whose name is being edited. */
  lockedId?: string | null
  onMove: (id: string, index: number) => void
  onRemove: (id: string) => void
}

export interface RowHandlers {
  draggable: boolean
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void
  onClickCapture: (event: MouseEvent<HTMLElement>) => void
}

export interface TrashHandlers {
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

export interface RowReorder {
  listRef: RefObject<HTMLDivElement | null>
  dragId: string | null
  dropTarget: DropTarget | null
  /** How far the pointer has travelled since the lift, for a row that follows it. */
  dragOffset: number
  /**
   * How far a resting row slides while the drag is live, in pixels: the offset
   * to the neighbour whose slot it stands in for, or 0 for a row that holds
   * still. Measured rather than assumed, because a list can put a block (the
   * brush player's steppers) between two rows and space them unevenly.
   */
  shiftFor: (index: number) => number
  rowProps: (id: string) => RowHandlers
  /** A grip's pointer down: lifts the row at once, with no hold. */
  startImmediately: (event: ReactPointerEvent<HTMLElement>, id: string) => void
  trashProps: TrashHandlers
}

interface Press {
  pointerId: number
  id: string
  startX: number
  startY: number
  held: boolean
  timer: number
}

interface Lift {
  /** Pointer y at the lift, the origin of `dragOffset`. */
  y: number
  /** The rows as laid out at the lift, relative to the list's top. */
  layout: RowBox[]
}

/**
 * The nearest ancestor that scrolls on its own, or null when the window is the
 * scroller. A landscape pane and the phone overlay each own their scroll, and
 * the overlay's page must not move underneath it.
 */
function scrollParent(node: Element | null): Element | null {
  for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return element
  }
  return null
}

/**
 * Reorders a list of rows by drag, with a trash target that removes. Fine
 * pointers use native HTML5 drag; coarse ones hold a row to lift it (HTML5
 * drag never fires on touch), then aim by pointer position, with the page
 * scrolling at the edges so a drop target below the fold can be reached.
 *
 * The rows' geometry is measured as the drag starts and kept: a row that is
 * drawn following the pointer, or easing out of its way, has moved on screen
 * but not in the list, and both aiming and the easing distance must read the
 * list as it was.
 */
export function useRowReorder({
  coarse,
  ids,
  rowSelector,
  trashSelector,
  lockedId,
  onMove,
  onRemove,
}: RowReorderOptions): RowReorder {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const lift = useRef<Lift | null>(null)
  const pointerY = useRef(0)
  const draggedRef = useRef(false)

  const endDrag = () => {
    setDragId(null)
    setDropTarget(null)
    setDragOffset(0)
  }
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  // The hold timer outlives the row if it unmounts inside the 380ms window, and
  // would then capture a pointer on a detached node.
  useEffect(() => endPress, [])

  const dropOn = (event: DragEvent, index: number) => {
    event.preventDefault()
    if (dragId !== null) onMove(dragId, index)
    endDrag()
  }

  const aimDrag = useCallback((y: number) => {
    const list = listRef.current
    if (!list) return
    const trash = list.querySelector(trashSelector)?.getBoundingClientRect()
    // Bounded both ways: everything below the trash row must not read as "remove".
    if (trash && y >= trash.top && y <= trash.bottom) {
      setDropTarget({ kind: 'trash' })
      return
    }
    const listTop = list.getBoundingClientRect().top
    const rows = (lift.current?.layout ?? []).map((box) => ({ top: box.top + listTop, bottom: box.bottom + listTop }))
    setDropTarget({ kind: 'row', index: dropIndexFor(rows, y) })
  }, [trashSelector])

  // The rows as they sit right now, relative to the list's top.
  const measureRows = (): RowBox[] => {
    const list = listRef.current
    if (!list) return []
    const listTop = list.getBoundingClientRect().top
    return [...list.querySelectorAll(rowSelector)].map((element) => {
      const box = element.getBoundingClientRect()
      return { top: box.top - listTop, bottom: box.bottom - listTop }
    })
  }

  const liftRow = (row: HTMLElement, id: string, pointerId: number, y: number) => {
    lift.current = { y, layout: measureRows() }
    draggedRef.current = true
    row.setPointerCapture(pointerId)
    setDragId(id)
    setDragOffset(0)
    // Aimed at the row's own slot, so a hold that never moves cannot pass the
    // "moved somewhere else" guard on release.
    setDropTarget({ kind: 'row', index: ids.indexOf(id) })
  }

  // A held row must not also pan the page. touch-action is fixed for the life of
  // a gesture, so the only way to take panning back mid-hold is a non-passive
  // listener; React's own touch handlers are passive and cannot do it.
  useEffect(() => {
    if (!coarse || dragId === null) return
    const swallow = (event: TouchEvent) => event.preventDefault()
    document.addEventListener('touchmove', swallow, { passive: false })
    return () => document.removeEventListener('touchmove', swallow)
  }, [coarse, dragId])
  // With panning suppressed, the drag itself has to reach anything off screen.
  useEffect(() => {
    if (!coarse || dragId === null) return
    const pane = scrollParent(listRef.current)
    let frame = 0
    const tick = () => {
      const step = edgeScrollStep(pointerY.current, window.innerHeight)
      if (step !== 0) {
        if (pane) pane.scrollBy(0, step)
        else window.scrollBy(0, step)
        aimDrag(pointerY.current)
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [coarse, dragId, aimDrag])
  // Last resort for the hold path: a release the row never sees would strand
  // dragId, and with it both the scroll-swallowing listener and the loop above.
  // Bubble phase, so the row's own handler has already committed the drop by the
  // time this runs. Never on the HTML5 path, where Chromium fires pointercancel
  // as the native drag takes over the gesture; dragend ends that drag instead.
  useEffect(() => {
    if (!coarse || dragId === null) return
    const rescue = (event: PointerEvent) => {
      if (press.current && press.current.pointerId !== event.pointerId) return
      endPress()
      endDrag()
    }
    window.addEventListener('pointerup', rescue)
    window.addEventListener('pointercancel', rescue)
    return () => {
      window.removeEventListener('pointerup', rescue)
      window.removeEventListener('pointercancel', rescue)
    }
  }, [coarse, dragId])

  const canLift = (id: string) => coarse && lockedId !== id && ids.length >= 2

  const onRowPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!canLift(id)) return
    // Re-armed here rather than on a timer: a click that never arrives would
    // otherwise leave the flag set and swallow the next tap.
    draggedRef.current = false
    // A second finger must not hijack a live press: the first one's pointerup
    // would then no longer match, and the drag could never be ended.
    if (press.current || dragId !== null) return
    const row = event.currentTarget
    const { pointerId, clientX, clientY } = event
    press.current = {
      pointerId,
      id,
      startX: clientX,
      startY: clientY,
      held: false,
      timer: window.setTimeout(() => {
        if (!press.current) return
        press.current.held = true
        liftRow(row, id, pointerId, pointerY.current)
      }, HOLD_MS),
    }
    pointerY.current = clientY
  }
  const startImmediately = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!canLift(id) || press.current || dragId !== null) return
    // The row's own handler would otherwise arm a hold over this lift.
    event.stopPropagation()
    const { pointerId, clientX, clientY } = event
    press.current = { pointerId, id, startX: clientX, startY: clientY, held: true, timer: 0 }
    pointerY.current = clientY
    liftRow(event.currentTarget, id, pointerId, clientY)
  }
  const onRowPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current
    if (!current || current.pointerId !== event.pointerId) return
    pointerY.current = event.clientY
    // Movement before the hold lands is a scroll or a swipe, and gives the row
    // up, measured in both axes, since a sideways swipe is no less a gesture.
    if (!current.held) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > HOLD_SLOP) endPress()
      return
    }
    setDragOffset(event.clientY - (lift.current?.y ?? event.clientY))
    aimDrag(event.clientY)
  }
  const endRowPress = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = press.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.held && !cancelled) {
      const from = ids.indexOf(current.id)
      if (dropTarget?.kind === 'trash') onRemove(current.id)
      // A row released where it started is a cancelled drag, not an edit worth
      // an undo entry.
      else if (dropTarget?.kind === 'row' && dropTarget.index !== from) onMove(current.id, dropTarget.index)
    }
    endPress()
    endDrag()
  }

  const rowProps = (id: string): RowHandlers => {
    const index = ids.indexOf(id)
    return {
      draggable: !coarse && lockedId !== id,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = 'move'
        // The HTML5 path never lifts, but the resting rows still animate, and
        // that needs the same measurement the hold path takes.
        lift.current = { y: event.clientY, layout: measureRows() }
        setDragId(id)
      },
      onDragEnd: endDrag,
      onDragOver: (event) => {
        if (dragId === null) return
        event.preventDefault()
        setDropTarget({ kind: 'row', index })
      },
      onDrop: (event) => dropOn(event, index),
      onPointerDown: (event) => onRowPointerDown(event, id),
      onPointerMove: onRowPointerMove,
      onPointerUp: (event) => endRowPress(event, false),
      onPointerCancel: (event) => endRowPress(event, true),
      // The spec's signal that a capture vanished without an end event (row
      // unmounted, the OS took the gesture). Fires after pointerup, so a
      // committed drop is unaffected.
      onLostPointerCapture: (event) => endRowPress(event, true),
      // A drag's release can still synthesise a click. Swallowed in the capture
      // phase so it reaches neither the row (re-selecting the row just moved)
      // nor a child that stops propagation of its own: the name would open its
      // rename input, a stat chip would commit a change on top of the reorder.
      onClickCapture: (event) => {
        if (!draggedRef.current) return
        // Consumed here, so the flag never outlives the click it exists to swallow.
        draggedRef.current = false
        event.stopPropagation()
        event.preventDefault()
      },
    }
  }
  const trashProps: TrashHandlers = {
    onDragOver: (event) => {
      event.preventDefault()
      setDropTarget({ kind: 'trash' })
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event) => {
      event.preventDefault()
      if (dragId !== null) onRemove(dragId)
      endDrag()
    },
  }

  const shiftFor = (index: number): number => {
    if (dragId === null) return 0
    const from = ids.indexOf(dragId)
    const to = dropTarget?.kind === 'row' ? dropTarget.index : from
    const direction = rowShift(index, from, to)
    if (direction === 0) return 0
    const layout = lift.current?.layout ?? []
    const own = layout[index]
    const neighbour = layout[index + direction]
    if (!own || !neighbour) return 0
    return neighbour.top - own.top
  }

  return { listRef, dragId, dropTarget, dragOffset, shiftFor, rowProps, startImmediately, trashProps }
}
