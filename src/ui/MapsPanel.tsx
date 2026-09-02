import { useState } from 'react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { DotsGlyph, ExportGlyph, ImportGlyph } from './glyphs'
import { LibraryLists } from './LibraryLists'
import { useJsonFiles } from './useJsonFiles'

/**
 * The desktop's Library panel (spec D1): the document switcher, the rename
 * surface and the import entry, at the top of the left rail. It is the phone's
 * Maps screen in a panel, so everything below the heading is `LibraryLists`.
 */
export function MapsPanel() {
  const { importJson, exportJson, fileInput } = useJsonFiles()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const items: ContextMenuItem[] = [
    { label: 'Import JSON', icon: <ImportGlyph />, onClick: importJson },
    { label: 'Export JSON', icon: <ExportGlyph />, onClick: exportJson },
  ]
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h2>Maps</h2>
        </div>
        <button
          type="button"
          className="panel-dots"
          aria-label="Import and export files"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(event) => {
            // Hung from the button's bottom-right corner, its tail pointing back up at it.
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuAt({ x: rect.right, y: rect.bottom + 4 })
          }}
        >
          <DotsGlyph />
        </button>
      </div>
      <LibraryLists />
      {fileInput}
      {menuAt && (
        <ContextMenu
          ariaLabel="Import and export files"
          x={menuAt.x}
          y={menuAt.y}
          items={items}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  )
}
