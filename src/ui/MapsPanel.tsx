import { useState } from 'react'
import { newBoardTitle } from './boardFiles'
import { ContextMenu } from './ContextMenu'
import { DotsGlyph, PlusGlyph } from './glyphs'
import { LibraryLists } from './LibraryLists'
import { useStore } from './store'
import { useJsonFiles } from './useJsonFiles'
import { VersionLine } from './VersionLine'

/**
 * The desktop's Library panel (spec D1), opened from the header title.
 * `LibraryLists` also supplies the phone's Maps screen.
 */
export function MapsPanel() {
  const { state, dispatch } = useStore()
  const { items, fileInput } = useJsonFiles()
  const [menuTrigger, setMenuTrigger] = useState<HTMLButtonElement | null>(null)
  return (
    <section className="panel maps-panel">
      <div className="panel-heading">
        <h2>Maps</h2>
        <div className="panel-actions">
          <button
            type="button"
            className="panel-dots"
            aria-label="New board"
            data-label="New"
            onClick={() => dispatch({ type: 'tab-add', title: newBoardTitle(state.tabs) })}
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
      <VersionLine />
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
