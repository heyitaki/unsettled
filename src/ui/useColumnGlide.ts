import { useLayoutEffect, type RefObject } from 'react'

const DURATION = 240
const EASING = 'cubic-bezier(.2, .8, .2, 1)'
// Clip insets this far outside the card leave its focus rings and overhangs unclipped while the reveal runs.
const BLEED = 60
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
// A roster row drag in progress, during which the column holds still.
const HOLD = '.reordering'
// On the column while its cards overflow it even with Best moves and History shrunk to their floors.
const OVERFULL = 'overfull'

// Read while the card is in the page: a removed card reports zero for all four.
type Box = { top: number; left: number; width: number; height: number }

/**
 * Animates the cards of a column whose layout shifts as they change: the desktop
 * right rail is centred on the board, so any card growing, shrinking, arriving
 * or leaving moves every card in it. Each change glides the cards from where
 * they were drawn to their new places, eases a card's surface from its old
 * height to its new one, and opens a new card or closes a removed one with the
 * gap its neighbours glide around, fading it in or out.
 *
 * Positions come from offsetTop and offsetHeight, which ignore transforms. The
 * cards' animations touch only transform, opacity, clip-path and shadow, and the
 * surfaces and ghosts are absolutely positioned outside the observed cards, so
 * an animation never changes the column's layout or re-triggers the observers.
 *
 * Best moves and History shrink toward their floors to fit the column. When even
 * that overflows, shrinking only hides rows in two scrollers, so each settle first
 * marks the column overfull and the lists take their full height while the column
 * scrolls. The check runs on layout offsets, so ghosts and glides never count.
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

    /**
     * A card arriving or leaving shares its slot with neighbours still gliding toward or away
     * from it, so it is clipped to the gap between them: the clip runs on the glides' own
     * timing, its edges travel with the neighbours' edges, and the card opens or closes with
     * the gap instead of passing under or over them. Each value is how far to clip from that end.
     */
    const band = (box: Box, above: Box | undefined, below: Box | undefined) => ({
      top: above ? Math.min(Math.max(above.top + above.height - box.top, 0), box.height) : 0,
      bottom: below ? Math.min(Math.max(box.top + box.height - below.top, 0), box.height) : 0,
    })
    type Gap = { top: number; bottom: number }
    // An end that meets a neighbour clips at the card's own edge, so it tracks that neighbour from the first frame; a free end keeps its shadow.
    const clip = (gap: Gap, at: Gap) => {
      const end = (meets: number, value: number) => meets ? `${value}px` : `-${BLEED}px`
      return `inset(${end(at.top, gap.top)} -${BLEED}px ${end(at.bottom, gap.bottom)} -${BLEED}px)`
    }
    const shut = { top: 0, bottom: 0 }

    const ghost = (card: HTMLElement, box: Box, gap: Gap) => {
      const copy = card.cloneNode(true) as HTMLElement
      copy.dataset.ghost = ''
      copy.inert = true
      copy.setAttribute('aria-hidden', 'true')
      Object.assign(copy.style, { position: 'absolute', left: `${box.left}px`, width: `${box.width}px`, top: `${box.top - origin()}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '-1' })
      column.append(copy)
      // Under the cards, so the card replacing it fades in on top: a crossfade with no empty frame between them.
      copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION, easing: 'ease-in' }).finished.finally(() => copy.remove())
      copy.animate([{ clipPath: clip(shut, gap) }, { clipPath: clip(gap, gap) }], { duration: DURATION, easing: EASING })
    }

    /**
     * A card's content changes height at once, so its surface is drawn by a stand-in
     * under it that eases from the old height to the new one, carrying the card's
     * fill, radius and shadow. The card drops its own shadow meanwhile, so a shorter
     * card shows no edge on the stand-in, and a taller one is clipped to it.
     */
    const resurface = (card: HTMLElement, box: Box, before: Box, shift: number) => {
      const running = surfaces.get(card)
      const drawnHeight = running ? parseFloat(getComputedStyle(running.backdrop).height) : before.height
      if (running) { for (const animation of running.animations) animation.cancel(); running.backdrop.remove() }
      const style = getComputedStyle(card)
      if (style.backgroundColor === TRANSPARENT || Math.abs(box.height - drawnHeight) < .5) return
      const backdrop = document.createElement('div')
      backdrop.dataset.ghost = ''
      backdrop.setAttribute('aria-hidden', 'true')
      Object.assign(backdrop.style, { position: 'absolute', left: `${card.offsetLeft}px`, width: `${card.offsetWidth}px`, top: `${card.offsetTop}px`, background: style.backgroundColor, borderRadius: style.borderRadius, boxShadow: style.boxShadow, pointerEvents: 'none', zIndex: '-1' })
      column.append(backdrop)
      const timing = { duration: DURATION, easing: EASING }
      const animations = [
        backdrop.animate([{ height: `${drawnHeight}px`, transform: `translateY(${shift}px)` }, { height: `${box.height}px`, transform: 'translateY(0)' }], timing),
        card.animate([{ boxShadow: 'none' }, { boxShadow: 'none' }], timing),
      ]
      const hidden = box.height - drawnHeight
      if (hidden > 0) {
        animations.push(card.animate([
          { clipPath: `inset(-${BLEED}px -${BLEED}px ${hidden}px -${BLEED}px)` },
          { clipPath: `inset(-${BLEED}px -${BLEED}px 0px -${BLEED}px)` },
        ], timing))
      }
      surfaces.set(card, { backdrop, animations })
      animations[0].finished.then(() => { backdrop.remove(); surfaces.delete(card) }, () => {})
    }

    const fit = () => {
      column.classList.remove(OVERFULL)
      const last = cards().at(-1)
      if (!last) return
      const end = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom) + parseFloat(getComputedStyle(column).paddingBottom)
      column.classList.toggle(OVERFULL, end > column.clientHeight + 1)
    }

    const settle = () => {
      fit()
      const animate = !reducedMotion.matches && column.offsetWidth === width
      width = column.offsetWidth
      const now = cards()
      const next = new Map(now.map((card) => [card, boxOf(card)]))
      // Where each card that stays is drawn right now, before any glide below restarts.
      const drawn = new Map([...boxes].filter(([card]) => next.has(card)).map(([card, box]) => [card, { ...box, top: box.top + drawnOffset(card) }]))
      const nearest = (order: HTMLElement[], index: number, step: 1 | -1, boxesOf: Map<HTMLElement, Box>) => {
        for (let at = index + step; at >= 0 && at < order.length; at += step) if (boxesOf.has(order[at])) return boxesOf.get(order[at])
      }
      for (const [index, card] of now.entries()) {
        const box = next.get(card)!
        if (!animate) continue
        const before = boxes.get(card)
        if (!before) {
          // Opens from the gap its neighbours are drawn around now, and fades in as it does.
          const gap = band(box, nearest(now, index, -1, drawn), nearest(now, index, 1, drawn))
          card.animate([{ opacity: 0, clipPath: clip(gap, gap) }, { opacity: 1, clipPath: clip(shut, gap) }], { duration: DURATION, easing: EASING })
          continue
        }
        // Only a layout move starts a glide: a settle that moved nothing leaves the one in flight to finish its easing.
        const moved = Math.abs(box.top - before.top) > .5
        const shift = before.top + drawnOffset(card) - box.top
        if (moved && Math.abs(shift) > .5) {
          glides.get(card)?.animation.cancel()
          const animation = card.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], { duration: DURATION, easing: EASING })
          glides.set(card, { animation, from: shift })
        }
        if (Math.abs(box.height - before.height) > .5) resurface(card, box, before, moved ? shift : 0)
      }
      if (animate) {
        // Closes onto the gap its neighbours glide to.
        const order = [...boxes.keys()]
        for (const [index, card] of order.entries()) if (!next.has(card)) ghost(card, boxes.get(card)!, band(boxes.get(card)!, nearest(order, index, -1, next), nearest(order, index, 1, next)))
      }
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
