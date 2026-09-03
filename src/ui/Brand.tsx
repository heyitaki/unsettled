/** The three-hex mark and the name; the desktop site header and the phone's brand row both render it. */
export function Brand() {
  return (
    <>
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h1>Unsettled</h1>
    </>
  )
}
