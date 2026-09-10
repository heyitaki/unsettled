import { useState } from 'react'
import { ContextMenu } from './ContextMenu'
import { DotsGlyph } from './glyphs'
import { LibraryLists } from './LibraryLists'
import { useJsonFiles } from './useJsonFiles'

/**
 * The desktop's Library panel (spec D1): the document switcher, the rename
 * surface and the import entry, at the top of the left rail. It is the phone's
 * Maps screen in a panel, so everything below the heading is `LibraryLists`.
 */
export function MapsPanel() {
  const { items, fileInput } = useJsonFiles()
  const [menuTrigger, setMenuTrigger] = useState<HTMLButtonElement | null>(null)
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
          aria-expanded={menuTrigger !== null}
          onClick={(event) => setMenuTrigger(menuTrigger ? null : event.currentTarget)}
        >
          <DotsGlyph />
        </button>
      </div>
      <LibraryLists />
      {fileInput}
      {menuTrigger && (
        <ContextMenu
          ariaLabel="Import and export files"
          trigger={menuTrigger}
          items={items}
          onClose={() => setMenuTrigger(null)}
        />
      )}
    </section>
  )
}
