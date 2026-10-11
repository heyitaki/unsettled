import { ImportButton } from '../ImportDialog'
import { LibraryLists } from '../LibraryLists'
import { useJsonFiles } from '../useJsonFiles'
import { PhoneOverlay } from './PhoneOverlay'

/**
 * Import, then the desktop Library panel's body, in a full-screen overlay (spec S7).
 * Selecting, opening, importing and New board act and close the screen.
 * Rename, delete and sort keep it open.
 */
export function MapsScreen({ onClose }: { onClose: () => void }) {
  const { items, fileInput } = useJsonFiles({ onImported: onClose })
  return (
    <PhoneOverlay title="Maps" menu={items} menuLabel="Import and export files" onClose={onClose}>
      <ImportButton onNavigate={onClose} />
      <LibraryLists onNavigate={onClose} />
      {fileInput}
    </PhoneOverlay>
  )
}
