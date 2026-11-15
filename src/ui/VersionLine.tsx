import { useOtaStatus } from '../native/otaStatus'

// ponytail: every install comes from TestFlight today, and this scheme opens it. Once the app is on the
// App Store, pick the link by install source (a native check) so store installs go to the store page.
const TESTFLIGHT_URL = 'itms-beta://'

/** The iOS app's running bundle label, one centred line at the foot of both Maps surfaces; the website build renders nothing. */
export function VersionLine() {
  const { bundleVersion, storeUpdate } = useOtaStatus()
  if (import.meta.env.MODE !== 'native' || (bundleVersion === null && !storeUpdate)) return null
  return (
    <p className="version-line">
      {bundleVersion !== null && `Version ${bundleVersion}`}
      {bundleVersion !== null && storeUpdate && ' · '}
      {storeUpdate && <a href={TESTFLIGHT_URL}>Update in TestFlight</a>}
    </p>
  )
}
