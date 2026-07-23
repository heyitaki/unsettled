import { RESOURCES, type BuildingTier, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import { activeTab, useStore, type Tool } from './store'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const PIECES: ('road' | BuildingTier)[] = ['road', 'settlement', 'city', 'superCity']

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}`
    : tool.kind === 'piece' ? `${tool.kind}:${tool.tier}` : tool.kind

export function ToolPalette() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  return (
    <section className="panel tools-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Build mode</span>
          <h2>Board tools</h2>
        </div>
        <div className="history-buttons">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={!tab.past.length}>Undo</button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={!tab.future.length}>Redo</button>
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
              onClick={() => dispatch({ type: 'tool', tool: { kind: 'tile', tile } })}
            >
              <span className="swatch" style={{ background: TILE_COLORS[tile] }} />
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
              onClick={() => dispatch({ type: 'tool', tool: { kind: 'token', number } })}
            >
              {number}
            </button>
          ))}
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Structures</span>
        <div className="tool-grid">
          {PIECES.map((tier) => (
            <button
              type="button"
              className={selected === `piece:${tier}` ? 'selected' : ''}
              key={tier}
              onClick={() => dispatch({ type: 'tool', tool: { kind: 'piece', tier } })}
            >
              {tier === 'superCity' ? 'castle' : tier}
            </button>
          ))}
          <button
            type="button"
            className={selected === 'robber' ? 'selected' : ''}
            onClick={() => dispatch({ type: 'tool', tool: { kind: 'robber' } })}
          >robber</button>
          <button
            type="button"
            className={selected === 'port' ? 'selected' : ''}
            onClick={() => dispatch({ type: 'tool', tool: { kind: 'port', resource: null, rate: 3 } })}
          >port</button>
          <button
            type="button"
            className={selected === 'erase' ? 'selected danger' : 'danger'}
            onClick={() => dispatch({ type: 'tool', tool: { kind: 'erase' } })}
          >erase</button>
        </div>
      </div>
    </section>
  )
}
