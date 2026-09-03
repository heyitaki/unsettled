import { useState } from 'react'
import { clearBoard, randomizeBoard } from '../model/board'
import { RESOURCES, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  ClearBoardGlyph,
  DiceGlyph,
  DotsGlyph,
  GLYPH_MUTED,
  RedoGlyph,
  StructureGlyph,
  UndoGlyph,
  type StructureShape,
} from './glyphs'
import { activeTab, useStore, type Tool } from './store'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]

const STRUCTURES: { key: StructureShape; label: string; tool: Tool; danger?: boolean }[] = [
  { key: 'road', label: 'road', tool: { kind: 'piece', tier: 'road' } },
  { key: 'settlement', label: 'settlement', tool: { kind: 'piece', tier: 'settlement' } },
  { key: 'city', label: 'city', tool: { kind: 'piece', tier: 'city' } },
  { key: 'superCity', label: 'super city', tool: { kind: 'piece', tier: 'superCity' } },
  { key: 'robber', label: 'robber', tool: { kind: 'robber' } },
  { key: 'port', label: 'port', tool: { kind: 'port', resource: null, rate: 3 } },
  { key: 'erase', label: 'erase', tool: { kind: 'erase' }, danger: true },
]

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}`
    : tool.kind === 'piece' ? `${tool.kind}:${tool.tier}` : tool.kind

/**
 * The three tool rows, shared by the desktop palette and the phone's build
 * block: each tree lays them out through its own CSS.
 */
export function ToolGroups() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  // Clicking the already-selected tool clears the selection (kind 'none'), so a
  // second click on a highlighted button deselects it.
  const selectTool = (tool: Tool) =>
    dispatch({ type: 'tool', tool: selected === keyOf(tool) ? { kind: 'none' } : tool })
  // Preview the colour the active player will place with; with nobody selected
  // (their dot toggled off) the palette falls back to the neutral glyph beige.
  const pieceColor = tab.game.board.players.find((player) => player.id === tab.activePlayerId)?.color ?? GLYPH_MUTED
  // Super cities are a variant piece: offer the tool only on boards that already
  // have one (e.g. imported from a screenshot), so the palette stays base-game.
  const hasSuperCity = tab.game.board.buildings.some((building) => building.tier === 'superCity')
  const structures = hasSuperCity ? STRUCTURES : STRUCTURES.filter((item) => item.key !== 'superCity')
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
              className={`${selected === `token:${number}` ? 'selected ' : ''}${number === 6 || number === 8 ? 'hot' : ''}`}
              key={number}
              onClick={() => selectTool({ kind: 'token', number })}
            >
              {number}
            </button>
          ))}
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Structures<span className="tool-count">{pieces} {pieces === 1 ? 'piece' : 'pieces'}</span></span>
        <div className="tool-grid structure-grid">
          {structures.map((item) => {
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

/** The desktop tools panel: the phone header's dots menu over the shared tool rows. */
export function ToolPalette() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const history: ContextMenuItem[] = [
    { label: 'Undo', icon: <UndoGlyph />, disabled: tab.past.length === 0, onClick: () => dispatch({ type: 'undo' }) },
    { label: 'Redo', icon: <RedoGlyph />, disabled: tab.future.length === 0, onClick: () => dispatch({ type: 'redo' }) },
  ]
  const items: ContextMenuItem[] = [
    {
      label: 'Randomize board',
      icon: <DiceGlyph />,
      onClick: () => dispatch({ type: 'commit', board: randomizeBoard(tab.game.board) }),
    },
    {
      label: 'Clear board',
      icon: <ClearBoardGlyph />,
      danger: true,
      onClick: () => dispatch({ type: 'commit', board: clearBoard(tab.game.board) }),
    },
  ]
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Build mode</span>
          <h2>Board tools</h2>
        </div>
        <button
          type="button"
          className="panel-dots"
          aria-label="Board options"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuAt({ x: rect.right, y: rect.bottom + 4 })
          }}
        >
          <DotsGlyph />
        </button>
      </div>
      <ToolGroups />
      {menuAt && (
        <ContextMenu
          ariaLabel="Board options"
          x={menuAt.x}
          y={menuAt.y}
          history={history}
          items={items}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  )
}
