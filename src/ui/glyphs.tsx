import type { Resource } from '../model/types'
import { TILE_COLORS } from './colors'
import type { PaneId } from './mobilePanes'

// Shared inline icons, one flat family on a 20-unit grid (desktop spec D3,
// option C): pieces are filled blocks of a player or tool colour with no
// casing, counters and resources are filled silhouettes at the same weight, and
// the line-art marks (anchor, trash) are drawn thick enough to sit beside them.
// The board keeps its own piece shapes; only the robber's outline is shared.

const PIECE_INK = '#30271f'
/** The paper the cut-out detail of a flat glyph shows through. */
const PAPER = '#f8f3e8'
/**
 * Default body colour for glyphs with no player/tool colour of their own: the
 * page's muted ink, so a flat shape still reads on the parchment.
 */
export const GLYPH_MUTED = '#776f64'

export type StructureShape =
  | 'road' | 'settlement' | 'city' | 'superCity' | 'robber' | 'port' | 'erase'

/**
 * The robber, in board units, drawn by BoardCanvas. Its base is an arc of the
 * number token's disc rim, baked into the path rather than clipped.
 */
export const ROBBER_HEAD_CY = -10.5
export const ROBBER_HEAD_R = 10
export const ROBBER_BODY =
  'M0,-5.5 C10,-5.5 15.5,5 14.5,17.85 A23,23 0 0 1 -14.5,17.85 C-15.5,5 -10,-5.5 0,-5.5 Z'

/** Every flat glyph shares this box, so a row of them shares a baseline and a width. */
const GRID = '0 0 20 20'

/**
 * The road: a band swept along a winding S, wide at the foot and narrowing
 * toward the horizon so the icon reads as a road in perspective, with its
 * centre-line dashes tapering the same way. Generated once from the curve and
 * a width function, then pasted, so the hand never has to draw an offset curve.
 */
const ROAD_BAND = 'M5.01 20.68 5.1 20.56 5.19 20.44 5.28 20.33 5.36 20.21 5.45 20.1 5.54 19.99 5.62 19.88 5.71 19.77 5.79 19.67 5.88 19.57 5.96 19.47 6.05 19.37 6.13 19.28 6.22 19.18 6.31 19.09 6.4 19 6.5 18.92 6.59 18.83 6.69 18.75 6.78 18.67 6.89 18.59 6.99 18.52 7.1 18.44 7.2 18.37 7.3 18.31 7.41 18.25 7.54 18.18 7.7 18.11 7.87 18.04 8.06 17.97 8.26 17.89 8.47 17.82 8.7 17.74 8.93 17.66 9.18 17.59 9.43 17.51 9.69 17.43 9.95 17.35 10.22 17.26 10.49 17.18 10.77 17.09 11.04 17 11.32 16.9 11.6 16.8 11.88 16.69 12.16 16.58 12.44 16.46 12.7 16.34 12.92 16.23 13.13 16.12 13.35 16.02 13.58 15.91 13.81 15.79 14.04 15.67 14.27 15.56 14.51 15.43 14.75 15.31 14.99 15.18 15.23 15.05 15.46 14.91 15.7 14.77 15.93 14.63 16.16 14.48 16.39 14.32 16.61 14.15 16.83 13.97 17.05 13.78 17.26 13.57 17.47 13.34 17.68 13.09 17.87 12.79 18.04 12.46 18.17 12.12 18.25 11.78 18.3 11.45 18.32 11.13 18.32 10.82 18.29 10.53 18.23 10.24 18.17 9.96 18.09 9.69 17.99 9.44 17.88 9.18 17.76 8.94 17.63 8.71 17.49 8.48 17.33 8.25 17.17 8.04 17 7.83 16.81 7.63 16.62 7.44 16.41 7.25 16.2 7.08 15.97 6.92 15.73 6.76 15.46 6.61 15.14 6.47 14.81 6.36 14.49 6.28 14.18 6.23 13.87 6.19 13.57 6.17 13.28 6.16 12.99 6.16 12.7 6.17 12.41 6.18 12.13 6.19 11.85 6.2 11.58 6.22 11.31 6.23 11.06 6.25 10.81 6.26 10.58 6.26 10.36 6.27 10.16 6.27 9.98 6.26 9.83 6.25 9.7 6.24 9.61 6.23 9.53 6.21 9.44 6.18 9.32 6.14 9.21 6.09 9.09 6.04 8.98 5.98 8.86 5.91 8.75 5.84 8.65 5.77 8.54 5.7 8.45 5.62 8.35 5.55 8.27 5.47 8.19 5.4 8.12 5.33 8.06 5.26 8.01 5.2 7.96 5.14 7.93 5.09 7.91 5.06 7.89 5.04 7.89 5.04 7.88 5.06 7.88 5.1 7.87 5.16 7.85 5.22 7.83 5.26 7.82 5.28 7.82 5.27 7.83 5.24 7.85 5.2 7.89 5.14 7.95 5.08 8.02 5.01 8.09 4.93 8.19 4.85 8.29 4.77 8.4 4.68 8.52 4.59 8.64 4.51 8.77 4.42 8.91 4.34 9.05 4.25 9.2 4.17 9.35 4.09 9.5 4.01 9.65 3.94 9.81 3.87 9.95 3.8 10.1 3.74 10.25 3.69 10.42 3.63 10.6 3.57 10.79 3.52 10.99 3.47 11.19 3.42 11.4 3.37 11.62 3.32 11.85 3.28 12.08 3.23 12.31 3.19 12.54 3.15 12.78 3.11 13.02 3.07 13.25 3.03 13.49 3 13.73 2.96 13.96 2.93 14.19 2.89 14.42 2.86 14.65 2.82 14.87 2.79 15.08 2.75 15.28 2.72 15.49 2.69 15.69 2.66 15.9 2.63 16.1 2.6 16.31 2.57 16.51 2.55 16.72 2.52 16.92 2.5 17.12 2.47 17.32 2.45 17.52 2.43 17.72 2.41 17.91 2.39 18.1 2.37 18.29 2.35 18.47 2.33 18.65 2.31 18.83 2.29 19 2.27 19.17 2.25 19.33 2.24 19.48 2.22 19.63 2.2 19.57 1.2 19.42 1.2 19.26 1.2 19.11 1.2 18.94 1.2 18.77 1.2 18.6 1.2 18.42 1.2 18.23 1.2 18.04 1.2 17.85 1.2 17.65 1.2 17.46 1.2 17.25 1.19 17.05 1.19 16.84 1.2 16.63 1.2 16.42 1.2 16.21 1.2 15.99 1.21 15.78 1.21 15.56 1.22 15.35 1.23 15.13 1.24 14.92 1.25 14.71 1.26 14.49 1.27 14.27 1.28 14.04 1.28 13.81 1.29 13.57 1.3 13.33 1.31 13.09 1.32 12.84 1.33 12.59 1.34 12.34 1.36 12.09 1.37 11.84 1.39 11.59 1.41 11.35 1.43 11.1 1.45 10.85 1.48 10.61 1.51 10.38 1.55 10.14 1.59 9.91 1.63 9.68 1.68 9.46 1.74 9.25 1.8 9.04 1.86 8.85 1.93 8.65 2 8.45 2.07 8.25 2.15 8.06 2.23 7.86 2.32 7.67 2.41 7.48 2.5 7.3 2.6 7.12 2.7 6.94 2.81 6.77 2.92 6.6 3.04 6.43 3.16 6.27 3.29 6.12 3.43 5.97 3.58 5.83 3.74 5.7 3.92 5.58 4.11 5.48 4.33 5.39 4.57 5.33 4.84 5.31 5.11 5.32 5.36 5.35 5.6 5.41 5.83 5.48 6.04 5.56 6.24 5.65 6.44 5.76 6.63 5.87 6.81 5.99 6.99 6.12 7.16 6.26 7.33 6.4 7.49 6.55 7.65 6.71 7.81 6.88 7.96 7.05 8.11 7.23 8.25 7.42 8.39 7.61 8.52 7.81 8.65 8.02 8.76 8.23 8.88 8.47 8.99 8.74 9.09 9.03 9.18 9.32 9.25 9.61 9.3 9.89 9.35 10.18 9.38 10.46 9.41 10.74 9.43 11.02 9.45 11.3 9.47 11.58 9.48 11.85 9.5 12.11 9.51 12.37 9.53 12.61 9.55 12.84 9.57 13.05 9.6 13.24 9.63 13.41 9.66 13.55 9.69 13.65 9.73 13.72 9.76 13.74 9.78 13.74 9.79 13.77 9.81 13.82 9.86 13.87 9.91 13.92 9.97 13.98 10.04 14.03 10.11 14.08 10.19 14.13 10.27 14.18 10.36 14.22 10.44 14.26 10.53 14.29 10.61 14.32 10.69 14.33 10.76 14.35 10.83 14.35 10.88 14.35 10.93 14.35 10.96 14.34 10.97 14.33 10.96 14.32 10.94 14.32 10.89 14.34 10.82 14.36 10.74 14.4 10.66 14.42 10.61 14.42 10.59 14.4 10.6 14.35 10.63 14.28 10.68 14.19 10.73 14.07 10.79 13.94 10.86 13.8 10.94 13.64 11.01 13.46 11.09 13.28 11.17 13.08 11.25 12.88 11.33 12.67 11.41 12.46 11.49 12.24 11.58 12.02 11.66 11.79 11.74 11.56 11.82 11.33 11.9 11.11 11.99 10.9 12.06 10.73 12.12 10.55 12.17 10.37 12.22 10.17 12.27 9.96 12.32 9.73 12.37 9.5 12.42 9.26 12.47 9.01 12.52 8.75 12.57 8.49 12.62 8.22 12.67 7.95 12.72 7.67 12.78 7.39 12.83 7.11 12.89 6.83 12.96 6.54 13.03 6.26 13.11 5.97 13.19 5.68 13.28 5.38 13.38 5.09 13.5 4.8 13.63 4.53 13.75 4.28 13.88 4.04 14.01 3.81 14.15 3.58 14.29 3.36 14.44 3.15 14.58 2.94 14.73 2.75 14.88 2.56 15.03 2.38 15.18 2.2 15.33 2.03 15.48 1.87 15.62 1.72 15.77 1.57 15.91 1.43 16.06 1.29 16.19 1.16 16.33 1.03 16.46 0.92 16.58 0.8 16.7 0.69 16.81 0.59 16.92Z'
const ROAD_DASHES = 'M4.93 17.19 5.07 17.07 5.22 16.96 5.37 16.86 5.52 16.75 5.68 16.65 5.84 16.55 6.01 16.45 6.18 16.36 6.36 16.27 6.55 16.18 6.24 15.45 6.03 15.55 5.82 15.64 5.62 15.75 5.43 15.85 5.25 15.96 5.07 16.07 4.9 16.19 4.73 16.3 4.57 16.42 4.41 16.55ZM8.92 15.45 9.18 15.38 9.44 15.31 9.7 15.25 9.97 15.18 10.23 15.1 10.49 15.03 10.74 14.95 10.54 14.27 10.29 14.34 10.04 14.4 9.78 14.47 9.52 14.53 9.26 14.6 9 14.66 8.73 14.72ZM13.27 13.93 13.5 13.83 13.73 13.72 13.96 13.62 14.18 13.51 14.4 13.4 14.61 13.29 14.82 13.17 14.51 12.61 14.31 12.71 14.11 12.82 13.89 12.92 13.68 13.02 13.45 13.12 13.23 13.22 13 13.32ZM16.63 11.06 16.63 10.88 16.61 10.71 16.58 10.53 16.55 10.35 16.5 10.18 16.44 10 16.37 9.82 16.29 9.65 16.2 9.48 16.1 9.31 15.99 9.15 15.88 8.99 15.42 9.32 15.52 9.46 15.61 9.61 15.69 9.75 15.76 9.9 15.83 10.05 15.89 10.2 15.93 10.35 15.97 10.49 16 10.63 16.02 10.77 16.03 10.91 16.03 11.03ZM13.67 7.67 13.43 7.64 13.18 7.62 12.92 7.61 12.66 7.6 12.39 7.6 12.12 7.6 11.85 7.6 11.58 7.61 11.58 8.1 11.85 8.1 12.12 8.1 12.38 8.1 12.65 8.11 12.9 8.12 13.15 8.14 13.38 8.16 13.6 8.19ZM9.08 7.39 8.93 7.33 8.77 7.26 8.61 7.18 8.46 7.09 8.32 7 8.17 6.91 8.03 6.81 7.9 6.7 7.77 6.6 7.64 6.49 7.52 6.37 7.23 6.67 7.36 6.79 7.49 6.91 7.63 7.03 7.78 7.15 7.93 7.26 8.08 7.36 8.24 7.46 8.41 7.56 8.57 7.65 8.74 7.73 8.92 7.81ZM7.05 4.51 7.14 4.42 7.24 4.32 7.34 4.22 7.46 4.13 7.58 4.03 7.71 3.93 7.85 3.84 8 3.75 8.15 3.66 8.3 3.57 8.47 3.48 8.63 3.39 8.48 3.09 8.31 3.18 8.14 3.26 7.98 3.35 7.82 3.45 7.66 3.54 7.51 3.64 7.37 3.74 7.23 3.84 7.11 3.95 6.99 4.05 6.87 4.16 6.77 4.27ZM11.05 2.59 11.27 2.55 11.51 2.52 11.74 2.48 11.98 2.45 12.22 2.42 12.46 2.39 12.7 2.36 12.94 2.33 12.91 2.07 12.67 2.09 12.43 2.12 12.18 2.14 11.94 2.17 11.7 2.2 11.46 2.23 11.23 2.27 11 2.3ZM15.43 2.07 15.64 2.05 15.85 2.03 16.06 2.01 16.27 1.99 16.47 1.97 16.68 1.96 16.89 1.94 17.09 1.93 17.29 1.92 17.28 1.73 17.08 1.74 16.87 1.75 16.67 1.76 16.46 1.77 16.25 1.78 16.04 1.8 15.83 1.81 15.62 1.83 15.41 1.85Z'

/**
 * A piece or tool mark standing `size` px square. Pieces take `color` as their
 * fill; the robber, the anchor and the trash can inherit `currentColor`, so
 * they invert with the tile they sit on. Pass `currentColor` as the colour to
 * do the same for a piece (the selected tile).
 */
export function StructureGlyph({ shape, color, size = 16 }: {
  shape: StructureShape
  color: string
  size?: number
}) {
  const style = { height: size, width: size }
  switch (shape) {
    case 'road':
      return (
        <svg className="tool-icon" style={style} viewBox={GRID} aria-hidden="true">
          <g transform="translate(10 10) scale(0.92) translate(-10 -10)">
            <path d={ROAD_BAND} fill={color} />
            <path d={ROAD_DASHES} fill={PAPER} />
          </g>
        </svg>
      )
    case 'settlement':
      return (
        <svg className="tool-icon" style={style} viewBox={GRID} aria-hidden="true">
          <path d="M4.1 17V9.6L10 4.4l5.9 5.2V17Z" fill={color} />
        </svg>
      )
    case 'city':
      return (
        <svg className="tool-icon" style={style} viewBox={GRID} aria-hidden="true">
          <path d="M1.6 17.2V8.8l5.9-5.3 5.9 5.3V8.6h5v8.6Z" fill={color} />
        </svg>
      )
    case 'superCity':
      return (
        <svg className="tool-icon" style={style} viewBox={GRID} aria-hidden="true">
          <path d="M2.2 17V9.6l3.8-5.3 2.7 3.7V3.8h2.6V8l2.7-3.7 3.8 5.3V17Z" fill={color} />
        </svg>
      )
    case 'robber':
      return (
        <svg className="tool-icon" style={style} viewBox={GRID} aria-hidden="true">
          <circle cx="10" cy="5.4" r="3.2" />
          <path d="M4.2 17.2c0-4.9 2.2-7.6 5.8-7.6s5.8 2.7 5.8 7.6Z" />
        </svg>
      )
    case 'port': // an anchor, in line art the weight of the filled shapes
      return (
        <svg
          className="tool-icon"
          viewBox={GRID}
          style={{ ...style, fill: 'none' }}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <circle cx="10" cy="4.9" r="1.6" />
          <path d="M10 6.5v10.3M6.8 9.6h6.4M4.4 12.2a5.6 5.6 0 0 0 11.2 0" />
        </svg>
      )
    default: // erase — a trash can
      return (
        <svg
          className="tool-icon"
          viewBox={GRID}
          style={{ ...style, fill: 'none' }}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <path d="M3.4 5.8h13.2" />
          <path d="M7.8 5.8V3.6h4.4v2.2" />
          <path d="M5.4 5.8 6.2 17.2h7.6l.8-11.4" />
        </svg>
      )
  }
}

/** A hand resource: a flat terrain-coloured mark with its ink details. */
export function ResourceGlyph({ resource }: { resource: Resource }) {
  const fill = TILE_COLORS[resource]
  const shell = {
    className: 'stat-icon',
    viewBox: GRID,
    'aria-hidden': true,
  }
  switch (resource) {
    case 'wood': // pine over a dark trunk
      return (
        <svg {...shell}>
          <rect x="8.9" y="12.6" width="2.2" height="5.4" rx=".7" fill={PIECE_INK} />
          <path d="M10 2.2 14.8 9.2H5.2Z" fill={fill} />
          <path d="M10 6.6 16.2 14.4H3.8Z" fill={fill} />
        </svg>
      )
    case 'sheep': // fleece body, dark head and legs
      return (
        <svg {...shell}>
          <path d="M6.6 15.2v2.4M12.2 15.2v2.4" stroke={PIECE_INK} strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="9.4" cy="11" rx="5.6" ry="4.4" fill={fill} />
          <circle cx="15" cy="8.4" r="2.8" fill={PIECE_INK} />
        </svg>
      )
    case 'wheat': // three grain heads on a bound stalk
      return (
        <svg {...shell}>
          <path d="M10 18.6v-5.4M10 14.8 6.4 12.4M10 14.8l3.6-2.4" fill="none" stroke={PIECE_INK} strokeWidth="1.4" strokeLinecap="round" />
          <ellipse cx="10" cy="6.2" rx="2.5" ry="4.9" fill={fill} />
          <ellipse cx="4.6" cy="8.4" rx="2.2" ry="4.3" fill={fill} transform="rotate(-30 4.6 8.4)" />
          <ellipse cx="15.4" cy="8.4" rx="2.2" ry="4.3" fill={fill} transform="rotate(30 15.4 8.4)" />
        </svg>
      )
    case 'brick': // two courses in a running bond
      return (
        <svg {...shell}>
          <rect x="3.5" y="5.9" width="13" height="4" rx=".7" fill={fill} />
          <rect x="3.5" y="10.8" width="5.6" height="4" rx=".7" fill={fill} />
          <rect x="10.9" y="10.8" width="5.6" height="4" rx=".7" fill={fill} />
        </svg>
      )
    default: // ore — a pickaxe, ore-coloured head on a dark handle
      return (
        <svg {...shell}>
          <g transform="rotate(-40 10 10)">
            <rect x="9" y="7.2" width="2" height="11" rx=".7" fill={PIECE_INK} />
            <path d="M2.6 9C6 3.8 14 3.8 17.4 9 13.6 6.6 6.4 6.6 2.6 9Z" fill={fill} stroke={fill} strokeWidth="1.4" strokeLinejoin="round" />
          </g>
        </svg>
      )
  }
}

export type CounterShape = 'unknownCard' | 'devCard' | 'knight' | 'vpCard'

/** A tracked stat with no piece of its own, filled flat like the pieces. */
export function CounterGlyph({ shape, color = GLYPH_MUTED }: { shape: CounterShape; color?: string }) {
  const shell = {
    className: 'stat-icon',
    viewBox: GRID,
    fill: color,
    'aria-hidden': true,
  }
  switch (shape) {
    case 'unknownCard': // a card with the question cut out of it
      return (
        <svg {...shell}>
          <path d="M3.6 2.6h12.8v14.8H3.6Z" />
          <path
            d="M7.4 7.2c.1-1.5 1.1-2.4 2.6-2.4s2.6.8 2.6 2.2c0 1.1-.6 1.7-1.6 2.3-.8.5-1 1-1 2"
            fill="none"
            stroke={PAPER}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="10" cy="14.4" r="1.1" fill={PAPER} />
        </svg>
      )
    case 'devCard': // a fanned pair of cards, the front one cut out of the back
      return (
        <svg {...shell}>
          <rect x="7.2" y="2.6" width="7.8" height="11.4" rx=".5" transform="rotate(14 11.1 8.3)" />
          <rect x="4.4" y="5.4" width="7.8" height="11.4" rx=".5" transform="rotate(-8 8.3 11.1)" stroke={PAPER} strokeWidth="1.1" />
        </svg>
      )
    case 'knight': // shield — also the largest-army badge
      return (
        <svg {...shell}>
          <path d="M10 2.5 16.3 4.8v4.9c0 3.7-2.7 6.3-6.3 7.8-3.6-1.5-6.3-4.1-6.3-7.8V4.8Z" />
        </svg>
      )
    default: // vpCard — a star
      return (
        <svg {...shell}>
          <path d="M10 2.6 12.3 7.4l5.3.7-3.8 3.7 1 5.2-4.8-2.6-4.8 2.6 1-5.2-3.8-3.7 5.3-.7Z" />
        </svg>
      )
  }
}

export function NavigationGlyph({ pane }: { pane: PaneId }) {
  const common = {
    className: 'nav-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (pane) {
    case 'board':
      return <svg {...common}><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z" /></svg>
    case 'players':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.8 19v-1.6A5.2 5.2 0 0 1 9 12.2a5.2 5.2 0 0 1 5.2 5.2V19Z" />
          <circle cx="16.7" cy="9.2" r="2.4" />
          <path d="M15.2 13.6a4.2 4.2 0 0 1 5 4.1V19h-3.4" />
        </svg>
      )
    case 'picks':
      return (
        <svg {...common}>
          <path d="M11.2 3.2 18 7.1v7.8l-6.8 3.9-6.8-3.9V7.1Z" />
          <circle cx="16.7" cy="7.3" r="3.1" />
          <circle cx="16.7" cy="7.3" r=".8" />
        </svg>
      )
    case 'library':
      return (
        <svg {...common}>
          <rect x="5.2" y="4" width="13.6" height="15" rx="2" />
          <path d="M3 7.2v10.4A3.4 3.4 0 0 0 6.4 21H16M8.2 8h7.6M8.2 11.5h5.2" />
        </svg>
      )
  }
}

/** The colour hex that stands for a board wherever it is named; see boardColor.ts. */
export function BoardHexGlyph({ color, className }: { color: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 22" aria-hidden="true">
      <polygon points="10,1 18.7,6 18.7,16 10,21 1.3,16 1.3,6" fill={color} stroke={PIECE_INK} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

const LINE_ART = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg {...LINE_ART} className={className} viewBox="0 0 12 8" strokeWidth="2">
      <path d="M1.4 2 6 6.2 10.6 2" />
    </svg>
  )
}

export function PencilGlyph() {
  return (
    <svg {...LINE_ART} width="17" height="17" viewBox="0 0 20 20" strokeWidth="1.7">
      <path d="M13.2 3.4a1.9 1.9 0 0 1 2.7 2.7L7 15l-3.6.9.9-3.6 8.9-8.9Z" />
      <path d="M11.9 4.7 14.6 7.4" />
    </svg>
  )
}

export function DotsGlyph() {
  return (
    <svg width="17" height="5" viewBox="0 0 17 5" fill="currentColor" aria-hidden="true">
      <circle cx="2.4" cy="2.5" r="1.7" />
      <circle cx="8.5" cy="2.5" r="1.7" />
      <circle cx="14.6" cy="2.5" r="1.7" />
    </svg>
  )
}

export function PhotoGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 16 16" strokeWidth="1.5">
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="2.1" />
      <circle cx="5.5" cy="6.4" r="1.1" />
      <path d="M2.3 11.3 5.7 8.3l2.9 2.5 2-1.6 2.8 2.3" />
    </svg>
  )
}

/** The overlay header's back chevron. */
export function BackGlyph() {
  return (
    <svg {...LINE_ART} width="18" height="18" viewBox="0 0 18 18" strokeWidth="2">
      <path d="M11.2 3.4 5.6 9l5.6 5.6" />
    </svg>
  )
}

export function XMarkGlyph() {
  return (
    <svg {...LINE_ART} width="13" height="13" viewBox="0 0 12 12" strokeWidth="1.6">
      <path d="M2 2 10 10M10 2 2 10" />
    </svg>
  )
}

export function PlusGlyph() {
  return (
    <svg {...LINE_ART} width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.8">
      <path d="M6 1.4V10.6M1.4 6H10.6" />
    </svg>
  )
}

export function TrashGlyph() {
  return (
    <svg {...LINE_ART} width="14" height="15" viewBox="3 2.7 14 15.1" strokeWidth="1.5">
      <path d="M3.6 5.6H16.4" />
      <path d="M8 5.6V4.4a1.1 1.1 0 0 1 1.1-1.1h1.8a1.1 1.1 0 0 1 1.1 1.1V5.6" />
      <path d="M5.4 5.6 6.2 16.1a1.3 1.3 0 0 0 1.3 1.2h5a1.3 1.3 0 0 0 1.3-1.2L14.6 5.6" />
    </svg>
  )
}

/** The roster row's grip: six dots in two columns. */
export function GripGlyph() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
      <circle cx="1.6" cy="2" r="1.4" />
      <circle cx="6.4" cy="2" r="1.4" />
      <circle cx="1.6" cy="7" r="1.4" />
      <circle cx="6.4" cy="7" r="1.4" />
      <circle cx="1.6" cy="12" r="1.4" />
      <circle cx="6.4" cy="12" r="1.4" />
    </svg>
  )
}

/** The check beside a dropdown's current option. */
export function TickGlyph({ className }: { className?: string }) {
  return (
    <svg {...LINE_ART} className={className} viewBox="0 0 14 14" strokeWidth="2.2">
      <path d="M2 7.4 5.6 11 12 3.4" />
    </svg>
  )
}

/** The sort control's two opposed arrows. */
export function SortGlyph({ className }: { className?: string }) {
  return (
    <svg {...LINE_ART} className={className} width="10" height="10" viewBox="0 0 12 12" strokeWidth="1.6">
      <path d="M3.4 1.9v8.2M1.5 8.2 3.4 10.1 5.3 8.2" />
      <path d="M8.6 10.1V1.9M6.7 3.8 8.6 1.9 10.5 3.8" />
    </svg>
  )
}

export function UndoGlyph() {
  return (
    <svg {...LINE_ART} width="15" height="15" viewBox="0 0 20 20" strokeWidth="1.7">
      <path d="M4 8h8a4 4 0 0 1 0 8H8" />
      <path d="M7 5 4 8l3 3" />
    </svg>
  )
}

export function RedoGlyph() {
  return (
    <svg {...LINE_ART} width="15" height="15" viewBox="0 0 20 20" strokeWidth="1.7">
      <path d="M16 8H8a4 4 0 0 0 0 8h4" />
      <path d="M13 5l3 3-3 3" />
    </svg>
  )
}

/** A die face, for the randomize action. */
export function DiceGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="7" r="1.35" />
      <circle cx="13" cy="7" r="1.35" />
      <circle cx="10" cy="10" r="1.35" />
      <circle cx="7" cy="13" r="1.35" />
      <circle cx="13" cy="13" r="1.35" />
    </svg>
  )
}

/** An arrow down onto a line: a file leaving for the device. */
export function ExportGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 20 20" strokeWidth="1.6">
      <path d="M10 3V11.5 M6.4 7.9 10 11.5 13.6 7.9 M4 15.5H16" />
    </svg>
  )
}

/** An arrow up off a line: a file arriving from the device. */
export function ImportGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 20 20" strokeWidth="1.6">
      <path d="M10 11.5V3 M6.4 6.6 10 3 13.6 6.6 M4 15.5H16" />
    </svg>
  )
}

/** A hex struck through, for clearing the board. */
export function ClearBoardGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 20 20" strokeWidth="1.6">
      <path d="M10 2.6 16.4 6.3V13.7L10 17.4 3.6 13.7V6.3Z" />
      <path d="M6.3 13.4 13.7 6.4" />
    </svg>
  )
}
