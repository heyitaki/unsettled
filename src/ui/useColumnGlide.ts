import { useLayoutEffect, type RefObject } from 'react'

const DURATION = 240
const EASING = 'cubic-bezier(.2, .8, .2, 1)'
// Clip insets this far outside the card leave its focus rings and overhangs unclipped while the reveal runs.
const BLEED = 60
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

type Box = { top: number; height: number }

/**
 * Animates the cards of a column whose layout shifts as they change: the desktop
 * right rail is centred on the board, so any card growing, shrinking, arriving
 * or leaving moves every card in it. Each change glides the cards from where
 * they were drawn to their new places, eases a card's surface from its old
 * height to its new one, fades a new card in and fades a removed one out in place.
 *
 * Positions come from offsetTop and offsetHeight, which ignore transforms. The
 * cards' animations touch only transform, opacity, clip-path and shadow, and the
 * surfaces and ghosts are absolutely positioned outside the observed cards, so
 * an animation never changes the column's layout or re-triggers the observers.
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

    const cards = () => [...column.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.ghost === undefined)
    const boxOf = (card: HTMLElement): Box => ({ top: column.offsetTop + card.offsetTop, height: card.offsetHeight })
    // How far a glide still in flight draws its card from its old layout box. The easing is the effect's own, so the progress is already eased.
    const drawnOffset = (card: HTMLElement) => {
      const glide = glides.get(card)
      const progress = glide?.animation.effect?.getComputedTiming().progress
      return glide && progress != null ? glide.from * (1 - progress) : 0
    }

    const ghost = (card: HTMLElement, box: Box) => {
      const copy = card.cloneNode(true) as HTMLElement
      copy.dataset.ghost = ''
      copy.inert = true
      copy.setAttribute('aria-hidden', 'true')
      Object.assign(copy.style, { position: 'absolute', left: '0', right: '0', top: `${box.top - column.offsetTop}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '-1' })
      column.append(copy)
      // Under the cards, so the card replacing it fades in on top: a crossfade with no empty frame between them.
      copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION, easing: 'ease-in' }).finished.finally(() => copy.remove())
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
      Object.assign(backdrop.style, { position: 'absolute', left: `${card.offsetLeft}px`, width: `${card.offsetWidth}px`, top: `${box.top - column.offsetTop}px`, background: style.backgroundColor, borderRadius: style.borderRadius, boxShadow: style.boxShadow, pointerEvents: 'none', zIndex: '-1' })
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

    const settle = () => {
      const animate = !reducedMotion.matches && column.offsetWidth === width
      width = column.offsetWidth
      const next = new Map<HTMLElement, Box>()
      for (const card of cards()) {
        const box = boxOf(card)
        next.set(card, box)
        if (!animate) continue
        const before = boxes.get(card)
        if (!before) {
          card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DURATION, easing: EASING })
          continue
        }
        // Only a layout move starts a glide: a settle that moved nothing leaves the one in flight to finish its easing.
        const moved = Math.abs(box.top - before.top) > .5
        const shift = before.top + drawnOffset(card) - box.top
        if (moved && Math.abs(shift) > .5) {
          glides.get(card)?.animation.cancel()
          // Added to any entrance still running, so the two never fight over the transform.
          const animation = card.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], { duration: DURATION, easing: EASING, composite: 'add' })
          glides.set(card, { animation, from: shift })
        }
        if (Math.abs(box.height - before.height) > .5) resurface(card, box, before, moved ? shift : 0)
      }
      if (animate) for (const [card, box] of boxes) if (!next.has(card)) ghost(card, box)
      boxes = next
    }

    const resize = new ResizeObserver(settle)
    const watch = () => { resize.observe(column); for (const card of cards()) resize.observe(card) }
    const mutations = new MutationObserver((records) => {
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof HTMLElement && node.dataset.ghost !== undefined))) return
      watch()
      settle()
    })
    boxes = new Map(cards().map((card) => [card, boxOf(card)]))
    watch()
    mutations.observe(column, { childList: true })
    return () => { resize.disconnect(); mutations.disconnect() }
  }, [ref, enabled])
}
