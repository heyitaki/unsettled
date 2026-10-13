import { hasPieces, isBlank } from '../model/board'
import { RESOURCES, type LayoutId, type TileKind } from '../model/types'
import { TILE_COLORS } from './colors'
import {
  ClearBoardGlyph,
  ClearPiecesGlyph,
  DiceGlyph,
  NUMBER_TOKEN_EXTENT,
  NumberTokenFace,
} from './glyphs'
import { activeTab, useStore, type Tool } from './store'

const TILES: TileKind[] = [...RESOURCES, 'desert']
const TOKENS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const TOKEN_VIEW_BOX = `${-NUMBER_TOKEN_EXTENT} ${-NUMBER_TOKEN_EXTENT} ${NUMBER_TOKEN_EXTENT * 2} ${NUMBER_TOKEN_EXTENT * 2}`
const LAYOUT_LABEL: Record<LayoutId, string> = {
  standard4: '4 players',
  extension6: '5–6 players',
}

const keyOf = (tool: Tool): string => tool.kind === 'tile' ? `${tool.kind}:${tool.tile}`
  : tool.kind === 'token' ? `${tool.kind}:${tool.number}` : tool.kind

function Count({ have, of }: { have: number; of: number }) {
  return <span className={have < of ? 'tool-count short' : 'tool-count'}>{have}/{of}</span>
}

/** The shared build rows; each tree lays them out through CSS. */
export function ToolGroups({ onLayout, onRandomize, onClearPieces, onClear }: {
  onLayout(layout: LayoutId): void
  onRandomize(): void
  onClearPieces(): void
  onClear(): void
}) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const selected = keyOf(state.tool)
  const selectTool = (tool: Tool) =>
    dispatch({ type: 'tool', tool: selected === keyOf(tool) ? { kind: 'piece' } : tool })
  const { board } = tab.game
  const placed = board.hexes.filter((hex) => hex.tile).length
  const tokens = board.hexes.filter((hex) => hex.numberToken !== null).length
  const tokenTotal = board.hexes.filter((hex) => hex.tile !== 'desert').length
  return (
    <>
      <p className="tool-hint">Tap a corner to cycle settlement, city, empty. Tap an edge for a road, a tile to move the robber, or a port/empty coast to edit a port. Pick a terrain or number below, then tap a tile to set it. Tap again to clear it.</p>
      <div className="tool-group">
        <span className="tool-label">Layout</span>
        <div className="tool-grid layout-grid">
          {(Object.keys(LAYOUT_LABEL) as LayoutId[]).map((layout) => (
            <button
              type="button"
              key={layout}
              className={board.layout === layout ? 'selected' : ''}
              aria-pressed={board.layout === layout}
              onClick={() => onLayout(layout)}
            >
              {LAYOUT_LABEL[layout]}
            </button>
          ))}
        </div>
      </div>
      <div className="tool-group">
        <span className="tool-label">Terrain<Count have={placed} of={board.hexes.length} /></span>
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
        <span className="tool-label">Number token<Count have={tokens} of={tokenTotal} /></span>
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
        <span className="tool-label">Board</span>
        <div className="tool-grid structure-grid">
          <button type="button" onClick={onRandomize}>
            <DiceGlyph />
            Randomize
          </button>
          <button type="button" className="danger" disabled={!hasPieces(board)} onClick={onClearPieces}>
            <ClearPiecesGlyph />
            Clear pieces
          </button>
          <button type="button" className="danger" disabled={isBlank(board)} onClick={onClear}>
            <ClearBoardGlyph />
            Clear board
          </button>
        </div>
      </div>
    </>
  )
}
