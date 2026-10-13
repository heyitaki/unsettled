import { useEffect, useRef, useState } from 'react'
import { Brand } from '../Brand'
import { HeaderControls, type HeaderPanel } from '../HeaderControls'

/** The phone's brand scrolls away above the sticky controls row (spec S1). */
export function PhoneHeader({ building, onToggleMode, onOpen }: {
  building: boolean
  onToggleMode: () => void
  onOpen: (overlay: HeaderPanel) => void
}) {
  const [scrolled, setScrolled] = useState(false)
  const brandRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const brand = brandRef.current
    const head = headRef.current
    if (!brand || !head) return
    // The header sits flush under the brand row until it sticks, so the brand
    // row leaving the band above the header's sticky line is the moment the
    // page starts sliding under it. An observer costs nothing per scroll
    // frame, where measuring rects would force a layout; the one measurement
    // here seeds the state before the observer's first, asynchronous report.
    const stickyTop = parseFloat(getComputedStyle(head).top) || 0
    setScrolled(brand.getBoundingClientRect().bottom <= stickyTop)
    const observer = new IntersectionObserver(
      (entries) => setScrolled(!entries[entries.length - 1].isIntersecting),
      { rootMargin: `-${stickyTop}px 0px 0px 0px` },
    )
    observer.observe(brand)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div className="phone-brand" ref={brandRef}>
        <Brand />
      </div>
      <header className={scrolled ? 'phone-head scrolled' : 'phone-head'} ref={headRef}>
        <HeaderControls building={building} onToggleMode={onToggleMode} onOpen={(panel) => onOpen(panel)} />
      </header>
    </>
  )
}
