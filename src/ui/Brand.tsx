/** Ember (--accent) is as bright as the sea-blue page, so on it the settler's body takes the deep red the owner tuned for the old wax seal, which reads against that blue. */
const BODY = '#9c2f2b'

/** The mark and the name; the desktop site header and the phone's brand row both render it. The mark is the app icon's squat settler (docs/logo-options/make.mjs, option A2); public/favicon.svg draws it in Ember. */
export function Brand() {
  return (
    <>
      <svg className="brand-mark" viewBox="12 18 76 68" aria-hidden="true">
        <g transform="rotate(-6 50 52)">
          <path d="M22 80 V52 L50 22 L78 52 V80 Z" fill={BODY} stroke={BODY} strokeWidth="6" strokeLinejoin="round" />
          <circle cx="40" cy="57" r="8.5" fill="#fbf8f1" />
          <circle cx="43.57" cy="54.62" r="4.42" fill="#2d2924" />
          <circle cx="60" cy="57" r="8.5" fill="#fbf8f1" />
          <circle cx="63.57" cy="54.62" r="4.42" fill="#2d2924" />
          <path d="M45.2 71 Q53.15 77.3 60.2 69.5" fill="none" stroke="#2d2924" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <h1>Unsettled</h1>
    </>
  )
}
