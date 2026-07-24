import { clearBoard, randomizeBoard } from '../model/board'
import { RESOURCES, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import { activeTab, useStore, type Tool } from './store'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]

const STRUCTURES: { key: string; label: string; tool: Tool; danger?: boolean }[] = [
  { key: 'road', label: 'road', tool: { kind: 'piece', tier: 'road' } },
  { key: 'settlement', label: 'settlement', tool: { kind: 'piece', tier: 'settlement' } },
  { key: 'city', label: 'city', tool: { kind: 'piece', tier: 'city' } },
  { key: 'superCity', label: 'super city', tool: { kind: 'piece', tier: 'superCity' } },
  { key: 'robber', label: 'robber', tool: { kind: 'robber' } },
  { key: 'port', label: 'port', tool: { kind: 'port', resource: null, rate: 3 } },
  { key: 'erase', label: 'erase', tool: { kind: 'erase' }, danger: true },
]

// A touch of relative scale reads as tiers: settlement < city < super city.
// Port gets a bump because its silhouette carries a lot of empty margin.
const GLYPH_PX: Record<string, number> = { settlement: 17, city: 21, superCity: 23, port: 22 }

// Palette glyphs reuse the exact piece silhouettes drawn on the board
// (BoardCanvas), so a tool previews the model it places. Player pieces take the
// selected player's colour; the robber keeps its black board model (a black
// robber is what gets placed); port/erase inherit currentColor so they invert
// to white when their tile is selected.
function StructureGlyph({ shape, color }: { shape: string; color: string }) {
  const size = GLYPH_PX[shape]
  const style = size ? { width: size, height: size } : undefined
  switch (shape) {
    case 'road':
      return (
        <svg className="tool-icon" style={style} viewBox="0 0 20 20" aria-hidden="true">
          <rect x="8.2" y="2.4" width="3.6" height="15.2" rx="1.8" transform="rotate(34 10 10)" fill={color} stroke="#30271f" strokeWidth="1.2" />
        </svg>
      )
    case 'settlement':
      return (
        <svg className="tool-icon" style={style} viewBox="-18 -18 36 36" aria-hidden="true">
          <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" fill={color} stroke="#30271f" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'city':
      return (
        <svg className="tool-icon" style={style} viewBox="-16 -17 37 34" aria-hidden="true">
          <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" fill={color} stroke="#30271f" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'superCity':
      return (
        <svg className="tool-icon" style={style} viewBox="-16 -13 32 27" aria-hidden="true">
          <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" fill={color} stroke="#30271f" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'robber':
      // Inherit currentColor (like port/erase) so it inverts to white when the
      // robber tile is selected, instead of staying black on the accent fill.
      return (
        <svg className="tool-icon" style={style} viewBox="-16 -22 32 44" aria-hidden="true">
          <circle cy="-10" r="9" />
          <path d="M-12,21 C-14,2 -8,-4 0,-4 C8,-4 14,2 12,21 Z" />
        </svg>
      )
    case 'port':
      return (
        <svg className="tool-icon" style={style} viewBox="2.5 2.5 15 14" aria-hidden="true">
          <path d="M4 11h12l-1.9 4.6H5.9z" />
          <path d="M10.7 3.2 14.6 9.4H10.7z" />
          <rect x="9.7" y="3.4" width="1" height="8" />
        </svg>
      )
    default: // erase — a trash can (line art; fill:none overrides .tool-icon's fill)
      return (
        <svg
          className="tool-icon"
          viewBox="0 0 20 20"
          style={{ fill: 'none' }}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.6 5.6H16.4" />
          <path d="M8 5.6V4.4a1.1 1.1 0 0 1 1.1-1.1h1.8a1.1 1.1 0 0 1 1.1 1.1V5.6" />
          <path d="M5.4 5.6 6.2 16.1a1.3 1.3 0 0 0 1.3 1.2h5a1.3 1.3 0 0 0 1.3-1.2L14.6 5.6" />
          <path d="M8.4 8.7V14.3M11.6 8.7V14.3" />
        </svg>
      )
  }
}

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}`
    : tool.kind === 'piece' ? `${tool.kind}:${tool.tier}` : tool.kind

export function ToolPalette() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  // Clicking the already-selected tool clears the selection (kind 'none'), so a
  // second click on a highlighted button deselects it.
  const selectTool = (tool: Tool) =>
    dispatch({ type: 'tool', tool: selected === keyOf(tool) ? { kind: 'none' } : tool })
  // Preview the colour the active player will place with.
  const pieceColor = tab.board.players.find((player) => player.id === tab.activePlayerId)?.color ?? '#8a7a63'
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Build mode</span>
          <h2>Board tools</h2>
        </div>
        <div className="history-buttons">
          <button type="button" aria-label="Randomize" onClick={() => dispatch({ type: 'commit', board: randomizeBoard(tab.board) })}>
            <svg viewBox="0 0 20 20" className="btn-icon" aria-hidden="true">
              <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="7" cy="7" r="1.35" />
              <circle cx="13" cy="7" r="1.35" />
              <circle cx="10" cy="10" r="1.35" />
              <circle cx="7" cy="13" r="1.35" />
              <circle cx="13" cy="13" r="1.35" />
            </svg>
          </button>
          <button type="button" aria-label="Clear all" onClick={() => dispatch({ type: 'commit', board: clearBoard(tab.board) })}>
            <svg viewBox="0 0 20 20" className="btn-icon" style={{ fill: 'none' }} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
              <path d="M10 2.6 16.4 6.3 V13.7 L10 17.4 3.6 13.7 V6.3 Z" />
              <path d="M6.3 13.4 13.7 6.4" />
            </svg>
          </button>
          <button type="button" aria-label="Undo" onClick={() => dispatch({ type: 'undo' })} disabled={!tab.past.length}>←</button>
          <button type="button" aria-label="Redo" onClick={() => dispatch({ type: 'redo' })} disabled={!tab.future.length}>→</button>
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Terrain</span>
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
        <span className="tool-label">Structures</span>
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
                <StructureGlyph shape={item.key} color={pieceColor} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
