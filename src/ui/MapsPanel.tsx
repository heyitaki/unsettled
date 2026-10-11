import { useState } from 'react'
import { ContextMenu } from './ContextMenu'
import { DotsGlyph, PlusGlyph } from './glyphs'
import { LibraryLists } from './LibraryLists'
import { useStore } from './store'
import { useJsonFiles } from './useJsonFiles'

/**
 * The desktop's Library panel (spec D1): the document switcher and the rename
 * surface, under Board tools in the left rail. Everything below the heading is
 * `LibraryLists`, the list the phone's Maps screen shows under its import button.
 */
export function MapsPanel() {
  const { dispatch } = useStore()
  const { items, fileInput } = useJsonFiles()
  const [menuTrigger, setMenuTrigger] = useState<HTMLButtonElement | null>(null)
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <h2>Maps</h2>
        <div className="panel-actions">
          <button
            type="button"
            className="panel-dots head-add"
            aria-label="New board"
            onClick={() => dispatch({ type: 'tab-add' })}
          >
            <PlusGlyph />
          </button>
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
