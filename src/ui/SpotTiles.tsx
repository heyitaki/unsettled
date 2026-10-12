import { isRedToken } from '../model/board'
import { axialToPixel } from '../model/coords'
import type { Board, VertexId } from '../model/types'
import { BLANK_TILE_COLOR, INK_COLOR, readableInk, TILE_COLORS, TOKEN_COLOR } from './colors'
import { DesertGlyph } from './glyphs'
import { vertexDescription, vertexParts } from './vertexParts'

const PICK_TILE_SIDE = 14
const SMALL_TILE_SIDE = 11.5

export function SpotTiles({ board, vertexId, small = false }: { board: Board; vertexId: VertexId; small?: boolean }) {
  const side = small ? SMALL_TILE_SIDE : PICK_TILE_SIDE
  const k = side / PICK_TILE_SIDE
  const parts = vertexParts(board, vertexId)
  // A ranking held from another board can name a corner this board lacks.
  if (parts.length === 0) return null
  const centres = parts.map((part) => axialToPixel(part.coord, side))
  const halfWidth = Math.sqrt(3) / 2 * side
  const left = Math.min(...centres.map(({ x }) => x)) - halfWidth
  const top = Math.min(...centres.map(({ y }) => y)) - side
  const width = Number((Math.max(...centres.map(({ x }) => x)) + halfWidth - left).toFixed(2))
  const height = Number((Math.max(...centres.map(({ y }) => y)) + side - top).toFixed(2))
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (-90 + 60 * index) * Math.PI / 180
    return `${(side - 0.8) * Math.cos(angle)},${(side - 0.8) * Math.sin(angle)}`
  }).join(' ')
  return (
    <svg
      className={`spot-tiles${small ? ' spot-tiles-small' : ''}`}
      role="img"
      aria-label={vertexDescription(board, vertexId)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {parts.map((part, index) => {
        const { x, y } = centres[index]
        const transform = `translate(${x - left} ${y - top})`
        if (part.kind === 'port') {
          const fill = part.tile === null ? TOKEN_COLOR : TILE_COLORS[part.tile]
          return (
            <g key={index} className="spot-tile spot-port" transform={transform}>
              <rect x={-10 * k} y={-6 * k} width={20 * k} height={12 * k} rx={6 * k} strokeWidth={k} stroke={INK_COLOR} fill={fill} />
              <text textAnchor="middle" y={2.7 * k} fill={readableInk(fill)} style={{ fontSize: 7.5 * k }}>{part.rate}:1</text>
            </g>
          )
        }
        const fontSize = (part.number !== null && part.number >= 10 ? 8.5 : 10) * k
        return (
          <g key={index} className="spot-tile" transform={transform}>
            <polygon points={points} fill={part.tile === null ? BLANK_TILE_COLOR : TILE_COLORS[part.tile]} />
            {part.tile === 'desert' ? (
              <g transform={`translate(${-7 * k} ${-7 * k}) scale(${0.7 * k})`}><DesertGlyph /></g>
            ) : part.number !== null && (
              <>
                <circle r={7.6 * k} fill={TOKEN_COLOR} stroke={INK_COLOR} strokeWidth={0.8 * k} />
                <text textAnchor="middle" className={isRedToken(part.number) ? 'token-text hot' : 'token-text'} y={0.35 * fontSize} style={{ fontSize }}>{part.number}</text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
