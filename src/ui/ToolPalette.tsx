import { useBoardActions } from './boardActions'
import { RESOURCES, type LayoutId, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import {
  ChevronGlyph,
  ClearBoardGlyph,
  GLYPH_MUTED,
  NUMBER_TOKEN_EXTENT,
  NumberTokenFace,
  StructureGlyph,
  type StructureShape,
} from './glyphs'
import { ImportButton } from './ImportDialog'
import { activeTab, useStore, type Tool } from './store'
import { UndoRedoButtons } from './UndoRedoButtons'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const TOKEN_VIEW_BOX = `${-NUMBER_TOKEN_EXTENT} ${-NUMBER_TOKEN_EXTENT} ${NUMBER_TOKEN_EXTENT * 2} ${NUMBER_TOKEN_EXTENT * 2}`
const LAYOUT_LABEL: Record<LayoutId, string> = {
  standard4: '4 players',
  extension6: '5–6 players',
}

const STRUCTURES: { key: StructureShape; label: string; tool: Tool; danger?: boolean }[] = [
  { key: 'robber', label: 'robber', tool: { kind: 'robber' } },
  { key: 'port', label: 'port', tool: { kind: 'port', resource: null, rate: 3 } },
  { key: 'erase', label: 'erase', tool: { kind: 'erase' }, danger: true },
]

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}` : tool.kind

/**
 * The tool rows, shared by the desktop palette and the phone's build
 * block: each tree lays them out through its own CSS.
 */
export function ToolGroups({ onLayout, onClear }: { onLayout(layout: LayoutId): void; onClear(): void }) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  const selectTool = (tool: Tool) =>
    dispatch({ type: 'tool', tool: selected === keyOf(tool) ? { kind: 'piece' } : tool })
  // Preview the colour the active player will place with; with nobody selected
  // (their dot toggled off) the palette falls back to the neutral glyph beige.
  const pieceColor = tab.game.board.players.find((player) => player.id === tab.activePlayerId)?.color ?? GLYPH_MUTED
  const placed = tab.game.board.hexes.filter((hex) => hex.tile).length
  const pieces = tab.game.board.roads.length + tab.game.board.buildings.length
  return (
    <>
      <div className="tool-group">
        <span className="tool-label">Layout</span>
        <div className="tool-grid layout-grid">
          {(Object.keys(LAYOUT_LABEL) as LayoutId[]).map((layout) => (
            <button
              type="button"
              key={layout}
              className={tab.game.board.layout === layout ? 'selected' : ''}
              aria-pressed={tab.game.board.layout === layout}
              onClick={() => onLayout(layout)}
            >
              {LAYOUT_LABEL[layout]}
            </button>
          ))}
        </div>
      </div>
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
        <span className="tool-label">Other tools<span className="tool-count">{pieces} {pieces === 1 ? 'piece' : 'pieces'}</span></span>
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
          <button type="button" className="danger" onClick={onClear}>
            <ClearBoardGlyph />
            clear all
          </button>
        </div>
        <p className="tool-hint">With no tool selected, tap a corner on the board to cycle settlement, city, empty. Tap an edge to add or remove a road, or a port to edit it.</p>
      </div>
    </>
  )
}

/** The desktop import entry and tool rows folded behind Edit manually. */
export function ToolPalette() {
  const { state, dispatch } = useStore()
  const { randomize, clear, chooseLayout, confirm } = useBoardActions(activeTab(state), dispatch)
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <h2>Board tools</h2>
        <UndoRedoButtons />
      </div>
      <ImportButton />
      <details
        className="tools-manual"
        // A tool nobody can see must not paint, so folding the rows drops it.
        onToggle={(event) => {
          dispatch({ type: 'tool', tool: { kind: event.currentTarget.open ? 'piece' : 'none' } })
        }}
      >
        <summary aria-label="Edit manually">
          <span className="tools-manual-label">Edit manually<ChevronGlyph className="menu-chevron" /></span>
          or
          <button
            type="button"
            className="tools-randomize"
            aria-label="Randomize board"
            // A click on a button inside a summary never toggles the fold.
            onClick={randomize}
          >
            randomize
          </button>
        </summary>
        <ToolGroups onLayout={chooseLayout} onClear={clear} />
      </details>
      {confirm}
    </section>
  )
}
