import { useState } from 'react'
import { boardMenu } from './boardMenu'
import { RESOURCES, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import { ContextMenu } from './ContextMenu'
import {
  ChevronGlyph,
  DotsGlyph,
  GLYPH_MUTED,
  NUMBER_TOKEN_EXTENT,
  NumberTokenFace,
  StructureGlyph,
  type StructureShape,
} from './glyphs'
import { ImportButton } from './ImportDialog'
import { activeTab, useStore, type Tool } from './store'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const TOKEN_VIEW_BOX = `${-NUMBER_TOKEN_EXTENT} ${-NUMBER_TOKEN_EXTENT} ${NUMBER_TOKEN_EXTENT * 2} ${NUMBER_TOKEN_EXTENT * 2}`

const STRUCTURES: { key: StructureShape; label: string; tool: Tool; danger?: boolean }[] = [
  { key: 'settlement', label: 'pieces', tool: { kind: 'piece' } },
  { key: 'robber', label: 'robber', tool: { kind: 'robber' } },
  { key: 'port', label: 'port', tool: { kind: 'port', resource: null, rate: 3 } },
  { key: 'erase', label: 'erase', tool: { kind: 'erase' }, danger: true },
]

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}` : tool.kind

/**
 * The three tool rows, shared by the desktop palette and the phone's build
 * block: each tree lays them out through its own CSS.
 */
export function ToolGroups() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  const selectTool = (tool: Tool) =>
    dispatch({ type: 'tool', tool: selected === keyOf(tool) ? { kind: 'none' } : tool })
  // Preview the colour the active player will place with; with nobody selected
  // (their dot toggled off) the palette falls back to the neutral glyph beige.
  const pieceColor = tab.game.board.players.find((player) => player.id === tab.activePlayerId)?.color ?? GLYPH_MUTED
  // The counts the board caption used to carry (spec D3): how much terrain is
  // painted, and how many pieces stand on the board.
  const placed = tab.game.board.hexes.filter((hex) => hex.tile).length
  const pieces = tab.game.board.roads.length + tab.game.board.buildings.length
  return (
    <>
      <div className="tool-group">
        <span className="tool-label">Terrain<span className="tool-count">{placed}/{tab.game.board.hexes.length}</span></span>
        <div className="tool-grid terrain-grid">
          {TILES.map((tile) => (
            <button
              type="button"
              className={selected === `tile:${tile}` ? 'selected' : ''}
              key={tile}
              onClick={() => selectTool({ kind: 'tile', tile })}
            >
              <svg className="hex-swatch" viewBox="0 0 20 22" aria-hidden="true">
                <polygon points="10,1.2 18.8,6.1 18.8,15.9 10,20.8 1.2,15.9 1.2,6.1" fill={TILE_COLORS[tile]} />
              </svg>
              {tile}
            </button>
          ))}
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Number token</span>
        <div className="token-tools">
          {TOKENS.map((number) => (
            <button
              type="button"
              className={selected === `token:${number}` ? 'selected' : ''}
              key={number}
              aria-label={String(number)}
              onClick={() => selectTool({ kind: 'token', number })}
            >
              <svg viewBox={TOKEN_VIEW_BOX} aria-hidden="true">
                <NumberTokenFace number={number} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Structures<span className="tool-count">{pieces} {pieces === 1 ? 'piece' : 'pieces'}</span></span>
        <div className="tool-grid structure-grid">
          {STRUCTURES.map((item) => {
            const active = selected === keyOf(item.tool)
            return (
              <button
                type="button"
                key={item.key}
                className={`${active ? 'selected ' : ''}${item.danger ? 'danger' : ''}`.trim()}
                onClick={() => selectTool(item.tool)}
              >
                <StructureGlyph shape={item.key} color={active ? 'currentColor' : pieceColor} size={22} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/**
 * The desktop tools panel: the phone header's dots menu, the import entry, then
 * the shared tool rows folded behind `Edit manually`.
 */
export function ToolPalette() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const [menuTrigger, setMenuTrigger] = useState<HTMLButtonElement | null>(null)
  const { history, items } = boardMenu(tab, dispatch)
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <h2>Board tools</h2>
        <button
          type="button"
          className="panel-dots"
          aria-label="Board options"
          aria-haspopup="menu"
          aria-expanded={menuTrigger !== null}
          onClick={(event) => setMenuTrigger(menuTrigger ? null : event.currentTarget)}
        >
          <DotsGlyph />
        </button>
      </div>
      <ImportButton />
      <details
        className="tools-manual"
        // A tool nobody can see must not paint, so folding the rows drops it.
        onToggle={(event) => {
          if (!event.currentTarget.open) dispatch({ type: 'tool', tool: { kind: 'none' } })
        }}
      >
        <summary>Edit manually<ChevronGlyph className="menu-chevron" /></summary>
        <ToolGroups />
      </details>
      {menuTrigger && (
        <ContextMenu
          ariaLabel="Board options"
          trigger={menuTrigger}
          history={history}
          items={items}
          onClose={() => setMenuTrigger(null)}
        />
      )}
    </section>
  )
}
