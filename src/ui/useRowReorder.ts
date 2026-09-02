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
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void
  onClickCapture: (event: MouseEvent<HTMLElement>) => void
}

/** The native drag is aimed and dropped on the list, never on a row. */
export interface ListHandlers {
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

export interface RowReorder {
  listRef: RefObject<HTMLDivElement | null>
  dragId: string | null
  dropTarget: DropTarget | null
  /**
   * How far row `index` is drawn from its resting slot while the drag is live,
   * in pixels, or 0 for a row that holds still. A resting row inside the span
   * slides into the slot of the neighbour it stands in for; the lifted row
   * follows the pointer on the hold path, and on the native path (where the
   * browser owns the pointer and draws its own drag image) sits in the slot it
   * would land in, so its own slot is free for the rows sliding into it.
   * Measured rather than assumed, because a list can put a block (the brush
   * player's steppers) between two rows and space them unevenly.
   */
  offsetFor: (index: number) => number
  rowProps: (id: string) => RowHandlers
  /** A grip's pointer down: lifts the row at once, with no hold. */
  startImmediately: (event: ReactPointerEvent<HTMLElement>, id: string) => void
  listProps: ListHandlers
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
 * drag never fires on touch) and scroll the page at the edges so a drop target
 * below the fold can be reached. Both paths aim at the list by pointer
 * position, never at whichever row happens to be under it.
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

  // What a pointer at `y` is aimed at, read against the layout taken at the
  // lift: the rows on screen have stepped aside since, and hit-testing them
  // would chase the row that just moved out of the way.
  const targetFor = useCallback((y: number): DropTarget | null => {
    const list = listRef.current
    if (!list) return null
    const trash = list.querySelector(trashSelector)?.getBoundingClientRect()
    // Bounded both ways: everything below the trash row must not read as "remove".
    if (trash && y >= trash.top && y <= trash.bottom) return { kind: 'trash' }
    const listTop = list.getBoundingClientRect().top
    const rows = (lift.current?.layout ?? []).map((box) => ({ top: box.top + listTop, bottom: box.bottom + listTop }))
    return { kind: 'row', index: dropIndexFor(rows, y) }
  }, [trashSelector])

  const aimDrag = useCallback((y: number) => {
    const target = targetFor(y)
    if (target) setDropTarget(target)
  }, [targetFor])

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

  const rowProps = (id: string): RowHandlers => ({
    draggable: !coarse && lockedId !== id,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      // The HTML5 path never lifts, but every row still animates, and that
      // needs the same measurement the hold path takes.
      lift.current = { y: event.clientY, layout: measureRows() }
      setDragId(id)
      // Aimed at its own slot until a dragover says otherwise, so a drop that
      // never moved cannot read as a reorder.
      setDropTarget({ kind: 'row', index: ids.indexOf(id) })
    },
    onDragEnd: endDrag,
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
  })

  // The native drag is aimed at the list, not at the rows inside it, and off the
  // layout taken at the drag's start: the rows move as they step aside, so the
  // row under the pointer is no longer the row the pointer aimed at, and the row
  // that just slid away leaves bare list behind it, which would refuse the drop.
  const listProps: ListHandlers = {
    onDragOver: (event) => {
      if (dragId === null) return
      event.preventDefault()
      aimDrag(event.clientY)
    },
    onDrop: (event) => {
      if (dragId === null) return
      event.preventDefault()
      // Read off the release point rather than the last aim, which React may
      // not have flushed: dragover is a continuous event and drop a discrete
      // one, so the drop would otherwise land a slot behind the pointer.
      const target = targetFor(event.clientY)
      if (target?.kind === 'trash') onRemove(dragId)
      // A row dropped back where it started is a cancelled drag, not an edit
      // worth an undo entry.
      else if (target?.kind === 'row' && target.index !== ids.indexOf(dragId)) onMove(dragId, target.index)
      endDrag()
    },
  }

  const offsetFor = (index: number): number => {
    if (dragId === null) return 0
    const layout = lift.current?.layout ?? []
    const from = ids.indexOf(dragId)
    const to = dropTarget?.kind === 'row' ? dropTarget.index : from
    const own = layout[index]
    if (index === from) {
      if (coarse) return dragOffset
      const landing = layout[to]
      return own && landing ? landing.top - own.top : 0
    }
    const direction = rowShift(index, from, to)
    if (direction === 0) return 0
    const neighbour = layout[index + direction]
    if (!own || !neighbour) return 0
    return neighbour.top - own.top
  }

  return { listRef, dragId, dropTarget, offsetFor, rowProps, startImmediately, listProps }
}
