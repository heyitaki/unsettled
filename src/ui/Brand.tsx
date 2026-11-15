import { useId } from 'react'
import { TILE_COLORS } from './colors'

/** The mark and the name; the desktop site header and the phone's brand row both render it. The mark is public/favicon.svg: one sharp-cornered tile with three candidate corners sized by rank, the best in the accent and the runners-up in wheat and wood. */
export function Brand() {
  // The mask cuts the outline 2.5 units clear of each dot, as favicon.svg does; the id is unique per mount and safe inside url().
  const cut = `brand-cut-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <>
      {/* The viewBox leaves room above the top vertex for the mitred corner. */}
      <svg className="brand-mark" viewBox="11 9.5 86 86" aria-hidden="true">
        <mask id={cut}>
          <rect x="0" y="0" width="110" height="110" fill="#fff" />
          <circle cx="80.31" cy="32.5" r="16.5" />
          <circle cx="50" cy="85" r="12.5" />
          <circle cx="19.69" cy="32.5" r="9.5" />
        </mask>
        <polygon points="50,15 80.31,32.5 80.31,67.5 50,85 19.69,67.5 19.69,32.5" fill="none" stroke="var(--ink)" strokeWidth="9" strokeLinejoin="miter" mask={`url(#${cut})`} />
        <circle cx="80.31" cy="32.5" r="14" fill="var(--accent)" />
        <circle cx="50" cy="85" r="10" fill={TILE_COLORS.wheat} />
        <circle cx="19.69" cy="32.5" r="7" fill={TILE_COLORS.wood} />
      </svg>
      <h1>Unsettled</h1>
    </>
  )
}
