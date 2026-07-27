import { clearBoard, randomizeBoard } from '../model/board'
import { RESOURCES, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import { GLYPH_MUTED, StructureGlyph, type StructureShape } from './glyphs'
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

export function ToolPalette() {
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
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Build mode</span>
          <h2>Board tools</h2>
        </div>
        <div className="history-buttons">
          <button type="button" aria-label="Randomize" onClick={() => dispatch({ type: 'commit', board: randomizeBoard(tab.game.board) })}>
            <svg viewBox="0 0 20 20" className="btn-icon" aria-hidden="true">
              <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="7" cy="7" r="1.35" />
              <circle cx="13" cy="7" r="1.35" />
              <circle cx="10" cy="10" r="1.35" />
              <circle cx="7" cy="13" r="1.35" />
              <circle cx="13" cy="13" r="1.35" />
            </svg>
          </button>
          <button type="button" aria-label="Clear all" onClick={() => dispatch({ type: 'commit', board: clearBoard(tab.game.board) })}>
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
          {structures.map((item) => {
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
