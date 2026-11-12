/** The mark and the name; the desktop site header and the phone's brand row both render it. The mark is public/favicon.svg: one tile with three candidate corners sized by rank, the best in the accent. */
export function Brand() {
  return (
    <>
      <svg className="brand-mark" viewBox="11.5 11.5 84 84" aria-hidden="true">
        <polygon points="50,15 80.31,32.5 80.31,67.5 50,85 19.69,67.5 19.69,32.5" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinejoin="round" />
        {/* Page-coloured rings cut the outline around each corner dot. */}
        <g stroke="var(--page)" strokeWidth="4">
          <circle cx="80.31" cy="32.5" r="12" fill="var(--accent)" />
          <circle cx="50" cy="85" r="8" fill="var(--ink)" />
          <circle cx="19.69" cy="32.5" r="5.5" fill="var(--ink)" />
        </g>
      </svg>
      <h1>Unsettled</h1>
    </>
  )
}
