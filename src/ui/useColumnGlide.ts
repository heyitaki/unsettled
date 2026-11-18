import { useLayoutEffect, type RefObject } from 'react'

const DURATION = 240
const EASING = 'cubic-bezier(.2, .8, .2, 1)'
// Clip insets this far outside the card leave its focus rings and overhangs unclipped while the reveal runs.
const BLEED = 60
// A swap fades the old contents out over this share of its time, then the new ones in over the rest, so the two never show at once.
const HANDOVER = .4
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
// A roster row drag in progress, during which the column holds still.
const HOLD = '.reordering'
// On the column while its cards overflow it even with Best moves and History shrunk to their floors.
const OVERFULL = 'overfull'

// Read while the card is in the page: a removed card reports zero for all four.
type Box = { top: number; left: number; width: number; height: number }
// A position or size from where it is drawn when a change lands to its layout value, linear in the glides' shared eased progress.
type Span = [from: number, to: number]
type Motion = { top: Span; height: Span }

const along = ([from, to]: Span, progress: number) => from + (to - from) * progress
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * Clip keyframes that keep a still element (its top and height in column coordinates)
 * off the surfaces gliding above and below it. Each inset follows a neighbour's edge,
 * which moves linearly in the eased progress the glides share, so a keyframe wherever
 * an inset meets a clamp makes the clip exact. An end with no neighbour stays open.
 */
const clear = (top: number, height: number, above?: Span, below?: Span): Keyframe[] => {
  const insetTop = (progress: number) => above ? clamp(along(above, progress) - top, -BLEED, height) : -BLEED
  const insetBottom = (progress: number) => below ? clamp(top + height - along(below, progress), -BLEED, height) : -BLEED
  const offsets = new Set([0, 1])
  const cross = ([from, to]: Span, value: number) => {
    const progress = (value - from) / (to - from)
    if (progress > 0 && progress < 1) offsets.add(progress)
  }
  if (above) { cross(above, top - BLEED); cross(above, top + height) }
  if (below) { cross(below, top + height + BLEED); cross(below, top) }
  return [...offsets].sort((a, b) => a - b).map((offset) => ({ offset, clipPath: `inset(${insetTop(offset)}px -${BLEED}px ${insetBottom(offset)}px -${BLEED}px)` }))
}

/**
 * Animates the cards of a column whose layout shifts as they change: the desktop
 * right rail is centred on the board, so any card growing, shrinking, arriving
 * or leaving moves every card in it. Each change glides the cards from where
 * they were drawn to their new places and eases a card's surface from its old
 * height to its new one. A card that replaces another (the first ones added and
 * removed between the same two staying cards) takes over its surface: one surface
 * morphs from the old card's box to the new card's while the old contents fade
 * out on it, then the new ones fade in. Any other card arriving or leaving shows
 * only where no other surface is drawn, opening or closing with the space its
 * neighbours glide around, and fades in or out.
 *
 * Positions come from offsetTop and offsetHeight, which ignore transforms. The
 * cards' animations touch only transform, opacity, clip-path and shadow, and the
 * surfaces and ghosts are absolutely positioned outside the observed cards, so
 * an animation never changes the column's layout or re-triggers the observers.
 *
 * Best moves and History shrink toward their floors to fit the column. When even
 * that overflows, shrinking only hides rows in two scrollers, so each settle first
 * marks the column overfull and the lists take their full height while the column
 * scrolls. Only an overfull column is a scroll box, since a scroll box would cut
 * off cards gliding past its edges as it shrinks. The check runs on layout
 * offsets, so ghosts and glides never count.
 *
 * While a row is dragged the column holds still: a drag adds a trash row, and
 * re-centring would carry the grabbed row out from under the pointer, which
 * makes Chromium cancel the drag. Pinned by a translate, the column grows
 * downward instead and glides back to centre when the drag ends.
 */
export function useColumnGlide(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const column = ref.current
    if (!column || !enabled || typeof ResizeObserver === 'undefined') return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timing = { duration: DURATION, easing: EASING }
    const glides = new WeakMap<Element, { animation: Animation; from: number }>()
    const surfaces = new WeakMap<Element, { backdrop: HTMLElement; animations: Animation[] }>()
    let boxes = new Map<HTMLElement, Box>()
    let width = column.offsetWidth
    // The column's layout top at the last settle, and how far a hold draws it from its layout.
    let top = column.offsetTop
    let pin = 0
    let holding = false

    const cards = () => [...column.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.ghost === undefined)
    // Where the column is drawn, so boxes taken before and during a hold compare as drawn.
    const origin = () => column.offsetTop + pin
    const boxOf = (card: HTMLElement): Box => ({ top: origin() + card.offsetTop, left: card.offsetLeft, width: card.offsetWidth, height: card.offsetHeight })
    // How far a glide still in flight draws its card from its old layout box. The easing is the effect's own, so the progress is already eased.
    const drawnOffset = (card: HTMLElement) => {
      const glide = glides.get(card)
      const progress = glide?.animation.effect?.getComputedTiming().progress
      return glide && progress != null ? glide.from * (1 - progress) : 0
    }
    // How tall a card's surface is drawn: a running stand-in's eased height, else its layout height.
    const drawnHeight = (card: HTMLElement, box: Box) => {
      const running = surfaces.get(card)
      return running ? parseFloat(getComputedStyle(running.backdrop).height) : box.height
    }

    const glide = (card: HTMLElement, shift: number) => {
      glides.get(card)?.animation.cancel()
      const animation = card.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], timing)
      glides.set(card, { animation, from: shift })
    }

    const unsurface = (card: HTMLElement) => {
      const running = surfaces.get(card)
      if (!running) return
      for (const animation of running.animations) animation.cancel()
      running.backdrop.remove()
      surfaces.delete(card)
    }

    /**
     * A card's content changes height at once, so its surface is drawn by a stand-in
     * under it that eases from the old height to the new one, carrying the card's
     * fill, radius and shadow. The card drops its own shadow meanwhile, so a shorter
     * card shows no edge on the stand-in, and a taller one is clipped to it. A swap
     * always draws one, since the incoming card fades in over it.
     */
    const resurface = (card: HTMLElement, box: Box, fromHeight: number, shift: number, always = false) => {
      unsurface(card)
      const style = getComputedStyle(card)
      if (style.backgroundColor === TRANSPARENT || (!always && Math.abs(box.height - fromHeight) < .5)) return
      const backdrop = document.createElement('div')
      backdrop.dataset.ghost = ''
      backdrop.setAttribute('aria-hidden', 'true')
      Object.assign(backdrop.style, { position: 'absolute', left: `${card.offsetLeft}px`, width: `${card.offsetWidth}px`, top: `${card.offsetTop}px`, background: style.backgroundColor, borderRadius: style.borderRadius, boxShadow: style.boxShadow, pointerEvents: 'none', zIndex: '-1' })
      column.append(backdrop)
      const animations = [
        backdrop.animate([{ height: `${fromHeight}px`, transform: `translateY(${shift}px)` }, { height: `${box.height}px`, transform: 'translateY(0)' }], timing),
        card.animate([{ boxShadow: 'none' }, { boxShadow: 'none' }], timing),
      ]
      const hidden = box.height - fromHeight
      if (hidden > 0) {
        // Flush with the card's sides, so the cut takes the stand-in's rounded corners; the card's shadow is off meanwhile anyway.
        const round = `round 0 0 ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`
        animations.push(card.animate([
          { clipPath: `inset(-${BLEED}px 0px ${hidden}px 0px ${round})` },
          { clipPath: `inset(-${BLEED}px 0px 0px 0px ${round})` },
        ], timing))
      }
      surfaces.set(card, { backdrop, animations })
      animations[0].finished.then(() => { backdrop.remove(); surfaces.delete(card) }, () => {})
    }

    // A copy of a removed card where it was drawn, under the cards, gone when its fade ends.
    const ghost = (card: HTMLElement, box: Box, drawnTop: number, fade: Keyframe[]) => {
      const copy = card.cloneNode(true) as HTMLElement
      copy.dataset.ghost = ''
      copy.inert = true
      copy.setAttribute('aria-hidden', 'true')
      Object.assign(copy.style, { position: 'absolute', left: `${box.left}px`, width: `${box.width}px`, top: `${drawnTop - origin()}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '-1' })
      column.append(copy)
      const remove = () => copy.remove()
      copy.animate(fade, DURATION).finished.then(remove, remove)
      return copy
    }

    const play = (now: HTMLElement[], next: Map<HTMLElement, Box>) => {
      // The staying cards split both orders into gaps; in each gap the first cards added take over from the first removed, one to one.
      const gaps = (order: HTMLElement[], stays: (card: HTMLElement) => boolean) => {
        const split: HTMLElement[][] = [[]]
        for (const card of order) if (stays(card)) split.push([]); else split[split.length - 1].push(card)
        return split
      }
      const removed = gaps([...boxes.keys()], (card) => next.has(card))
      const added = gaps(now, (card) => boxes.has(card))
      const kept = now.filter((card) => boxes.has(card))
      const replaces = new Map<HTMLElement, HTMLElement>()
      removed.forEach((gone, gap) => gone.forEach((card, index) => { const heir = added[gap]?.[index]; if (heir) replaces.set(heir, card) }))

      // Read before any animation restarts: each surface glides from where it (or the card it replaces) is drawn to its layout box.
      const motion = new Map<HTMLElement, Motion>()
      for (const card of now) {
        const box = next.get(card)!
        const from = boxes.has(card) ? card : replaces.get(card)
        const before = from && boxes.get(from)
        motion.set(card, from && before
          ? { top: [before.top + drawnOffset(from), box.top], height: [drawnHeight(from, before), box.height] }
          : { top: [box.top, box.top], height: [box.height, box.height] })
      }
      const topOf = (card: HTMLElement | undefined): Span | undefined => card && motion.get(card)!.top
      const bottomOf = (card: HTMLElement | undefined): Span | undefined => {
        const moving = card && motion.get(card)
        return moving && [moving.top[0] + moving.height[0], moving.top[1] + moving.height[1]]
      }

      for (const [index, card] of now.entries()) {
        const box = next.get(card)!
        const { top: [fromTop], height: [fromHeight] } = motion.get(card)!
        const shift = fromTop - box.top
        const before = boxes.get(card)
        const gone = replaces.get(card)
        if (before) {
          // Only a layout move starts a glide: a settle that moved nothing leaves the one in flight to finish its easing.
          const moved = Math.abs(box.top - before.top) > .5
          if (moved && Math.abs(shift) > .5) glide(card, shift)
          if (Math.abs(box.height - before.height) > .5) resurface(card, box, fromHeight, moved ? shift : 0)
        } else if (gone) {
          const old = boxes.get(gone)!
          unsurface(gone)
          if (Math.abs(shift) > .5) glide(card, shift)
          resurface(card, box, fromHeight, shift, true)
          card.animate([{ opacity: 0 }, { opacity: 0, offset: HANDOVER, easing: 'ease-out' }, { opacity: 1 }], DURATION)
          // Contents only, riding the shared surface and clipped to its eased height.
          const copy = ghost(gone, old, fromTop, [{ opacity: 1, easing: 'ease-out' }, { opacity: 0, offset: HANDOVER }, { opacity: 0 }])
          Object.assign(copy.style, { background: 'none', boxShadow: 'none' })
          copy.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-shift}px)` }], timing)
          copy.animate(clear(0, old.height, undefined, [fromHeight, box.height]), timing)
        } else {
          card.animate(clear(box.top, box.height, bottomOf(now[index - 1]), topOf(now[index + 1])), timing)
          card.animate([{ opacity: 0 }, { opacity: 1 }], timing)
        }
      }

      // A removed card nothing took over from stays where it was drawn, between the surfaces now on either side of its place.
      removed.forEach((gone, gap) => {
        const below = kept[gap]
        const above = below ? now[now.indexOf(below) - 1] : now[now.length - 1]
        for (const card of gone.slice(added[gap]?.length ?? 0)) {
          const box = boxes.get(card)!
          const drawnTop = box.top + drawnOffset(card)
          unsurface(card)
          const copy = ghost(card, box, drawnTop, [{ opacity: 1, easing: 'ease-out' }, { opacity: 0 }])
          copy.animate(clear(drawnTop, box.height, bottomOf(above), topOf(below)), timing)
        }
      })
    }

    const fit = () => {
      // Measuring without the class briefly ends the scroll box, so the scroll position is put back after.
      const scroll = column.scrollTop
      const was = column.classList.contains(OVERFULL)
      column.classList.remove(OVERFULL)
      const last = cards().at(-1)
      if (!last) return
      const end = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom) + parseFloat(getComputedStyle(column).paddingBottom)
      const overfull = end > column.clientHeight + 1
      column.classList.toggle(OVERFULL, overfull)
      column.scrollTop = scroll
      // The lists measured their edge shadows in the commit, before this resized them; their own observers saw no change across it.
      if (overfull !== was) for (const scroller of column.querySelectorAll('.scroll-edges')) scroller.dispatchEvent(new Event('scroll'))
    }

    const settle = () => {
      fit()
      const animate = !reducedMotion.matches && column.offsetWidth === width
      width = column.offsetWidth
      const now = cards()
      const next = new Map(now.map((card) => [card, boxOf(card)]))
      if (animate) play(now, next)
      boxes = next
      top = column.offsetTop
    }

    // Runs as a microtask after the commit that starts or ends a drag, before Chromium hit-tests the drag origin or the frame paints.
    const hold = () => {
      if (holding === (column.querySelector(HOLD) !== null)) return
      holding = !holding
      pin = holding ? top - column.offsetTop : 0
      column.style.translate = holding ? `0 ${pin}px` : ''
    }

    const resize = new ResizeObserver(settle)
    const watch = () => { resize.observe(column); for (const card of cards()) resize.observe(card) }
    const mutations = new MutationObserver((records) => {
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof HTMLElement && node.dataset.ghost !== undefined))) return
      watch()
      settle()
    })
    fit()
    boxes = new Map(cards().map((card) => [card, boxOf(card)]))
    watch()
    mutations.observe(column, { childList: true })
    const holds = new MutationObserver(hold)
    holds.observe(column, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    return () => { resize.disconnect(); mutations.disconnect(); holds.disconnect(); column.style.translate = ''; column.classList.remove(OVERFULL) }
  }, [ref, enabled])
}
