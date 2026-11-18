/** The mark and the name; the desktop site header and the phone's brand row both render it. The mark is the app icon's wax seal, trimmed to its edge in public/favicon.png. */
export function Brand() {
  return (
    <>
      <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.png`} alt="" />
      <h1>Unsettled</h1>
    </>
  )
}
