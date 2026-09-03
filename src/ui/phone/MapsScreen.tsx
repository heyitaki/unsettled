import type { ContextMenuItem } from '../ContextMenu'
import { ExportGlyph, ImportGlyph } from '../glyphs'
import { LibraryLists } from '../LibraryLists'
import { useJsonFiles } from '../useJsonFiles'
import { PhoneOverlay } from './PhoneOverlay'

/**
 * The desktop Library panel's body in a full-screen overlay (spec S7).
 * Selecting, opening, importing and New board act and close the screen.
 * Rename, delete and sort keep it open.
 */
export function MapsScreen({ onClose }: { onClose: () => void }) {
  const { importJson, exportJson, fileInput } = useJsonFiles({ onImported: onClose })
  const menu: ContextMenuItem[] = [
    { label: 'Import JSON', icon: <ImportGlyph />, onClick: importJson },
    { label: 'Export JSON', icon: <ExportGlyph />, onClick: exportJson },
  ]
  return (
    <PhoneOverlay title="Maps" menu={menu} menuLabel="Import and export files" onClose={onClose}>
      <LibraryLists onNavigate={onClose} />
      {fileInput}
    </PhoneOverlay>
  )
}
