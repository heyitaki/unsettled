import { useOtaStatus } from '../native/otaStatus'

/** The iOS app's running bundle label, last in both Maps surfaces; the website build renders nothing. */
export function VersionLine() {
  const { bundleVersion, storeUpdate } = useOtaStatus()
  if (import.meta.env.MODE !== 'native' || (bundleVersion === null && !storeUpdate)) return null
  return (
    <div className="version-line">
      {bundleVersion !== null && <p>Version {bundleVersion}</p>}
      {storeUpdate && <p>A newer version is on the App Store.</p>}
    </div>
  )
}
