import type { Resource } from '../model/types'
import { TILE_COLORS } from './colors'

// Shared inline icons. Two families, deliberately different in style:
//
// - StructureGlyph: the exact piece silhouettes drawn on the board
//   (BoardCanvas), filled with a player/tool colour over the board's ink
//   outline. Used by the tool palette (previewing what it places) and by the
//   player tallies (counting what is placed).
// - ResourceGlyph / CounterGlyph: the same filled-over-ink treatment for things
//   with no board piece. Resources tint their fill from TILE_COLORS so a card
//   matches its terrain; counters take a colour, defaulting to GLYPH_MUTED and
//   overridden to white on the award pills.

const PIECE_INK = '#30271f'
/**
 * Default body colour for glyphs with no player/tool colour of their own: a
 * light beige that sits back on the parchment. The ink outline carries the
 * shape, so the fill can stay this pale without the icon going mushy.
 */
export const GLYPH_MUTED = '#c2ae8c'

export type StructureShape =
  | 'road' | 'settlement' | 'city' | 'superCity' | 'robber' | 'port' | 'erase'

// SVG scales stroke-width with the viewBox, so a shared number would render at
// a different thickness per shape. Each outline is instead this fraction of its
// own viewBox span, which lands every border on the same rendered width.
const STROKE_RATIO = 2 / 36
const VIEW_SPAN: Record<StructureShape, number> = {
  road: 20, settlement: 36, city: 37, superCity: 32, robber: 44, port: 15, erase: 20,
}
const strokeFor = (shape: StructureShape): number => STROKE_RATIO * VIEW_SPAN[shape]
/** The same rendered width for the line art drawn in a 20-unit box. */
export const LINE_STROKE = STROKE_RATIO * 20

/**
 * Per-shape viewBox, cropped tight to the silhouette (stroke included) with the
 * aspect that crop implies. The tight crop is what lets a row of glyphs line up:
 * `size` is the rendered height of the artwork rather than of a box with a
 * different margin per shape, so every glyph stands the same height and every
 * bottom edge falls on one line, whatever its proportions. Width follows the
 * silhouette — a city is wider than a settlement, a robber narrower.
 */
const GEOMETRY: Record<StructureShape, { view: string; aspect: number }> = {
  road: { view: '1.05 2.24 17.9 15.52', aspect: 17.9 / 15.52 },
  settlement: { view: '-16 -16 32 30', aspect: 32 / 30 },
  city: { view: '-14.03 -15.13 35.06 28.36', aspect: 35.06 / 28.36 },
  superCity: { view: '-15.89 -12.19 31.78 24.38', aspect: 31.78 / 24.38 },
  robber: { view: '-13 -19 26 40', aspect: 26 / 40 },
  port: { view: '4 3.2 12 12.4', aspect: 12 / 12.4 },
  erase: { view: '3.04 2.74 13.92 15.12', aspect: 13.92 / 15.12 },
}

/**
 * A board piece silhouette standing `size` px tall, outlined at the same
 * rendered width as every other glyph — so a row of them reads as one set. Tier
 * is carried by the silhouettes themselves, not by scaling them up.
 */
export function StructureGlyph({ shape, color, size = 16 }: {
  shape: StructureShape
  color: string
  size?: number
}) {
  const { view, aspect } = GEOMETRY[shape]
  const style = { height: size, width: size * aspect }
  switch (shape) {
    case 'road':
      // Two rects, not a stroked one: the board draws an ink casing around a
      // colored core (BoardCanvas ROAD_CORE/ROAD_RADIUS), and the proportions
      // are copied from it — long, slim, and squared off rather than a capsule.
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <g transform="rotate(-38 10 10)">
            <rect x="0.6" y="7.5" width="18.8" height="5" rx="2.1" fill={PIECE_INK} />
            <rect
              x={0.6 + LINE_STROKE}
              y={7.5 + LINE_STROKE}
              width={18.8 - LINE_STROKE * 2}
              height={5 - LINE_STROKE * 2}
              rx={2.1 - LINE_STROKE}
              fill={color}
            />
          </g>
        </svg>
      )
    case 'settlement':
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" fill={color} stroke={PIECE_INK} strokeWidth={strokeFor('settlement')} strokeLinejoin="round" />
        </svg>
      )
    case 'city':
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" fill={color} stroke={PIECE_INK} strokeWidth={strokeFor('city')} strokeLinejoin="round" />
        </svg>
      )
    case 'superCity':
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" fill={color} stroke={PIECE_INK} strokeWidth={strokeFor('superCity')} strokeLinejoin="round" />
        </svg>
      )
    case 'robber':
      // Inherit currentColor (like port/erase) so it inverts to white when the
      // robber tile is selected, instead of staying black on the accent fill.
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <circle cy="-10" r="9" />
          <path d="M-12,21 C-14,2 -8,-4 0,-4 C8,-4 14,2 12,21 Z" />
        </svg>
      )
    case 'port':
      return (
        <svg className="tool-icon" style={style} viewBox={view} aria-hidden="true">
          <path d="M4 11h12l-1.9 4.6H5.9z" />
          <path d="M10.7 3.2 14.6 9.4H10.7z" />
          <rect x="9.7" y="3.4" width="1" height="8" />
        </svg>
      )
    default: // erase — a trash can (line art; fill:none overrides .tool-icon's fill)
      return (
        <svg
          className="tool-icon"
          viewBox={view}
          style={{ ...style, fill: 'none' }}
          stroke="currentColor"
          strokeWidth={strokeFor('erase')}
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

/** A hand resource: terrain-coloured body over the shared ink outline. */
export function ResourceGlyph({ resource }: { resource: Resource }) {
  const fill = TILE_COLORS[resource]
  const shell = {
    className: 'stat-icon',
    viewBox: '0 0 20 20',
    stroke: PIECE_INK,
    strokeWidth: LINE_STROKE,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
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
          <path d="M6.6 15.2v2.4M12.2 15.2v2.4" stroke={PIECE_INK} strokeWidth="1.6" />
          <ellipse cx="9.4" cy="11" rx="5.6" ry="4.4" fill={fill} />
          <circle cx="15" cy="8.4" r="2.8" fill={PIECE_INK} />
        </svg>
      )
    case 'wheat': // three grain heads on a bound stalk, sized to fill the box
      // Small heads read as a sprout, so they run nearly the full height and
      // the stalks stay short.
      return (
        <svg {...shell}>
          <path d="M10 18.6v-5.4M10 14.8 6.4 12.4M10 14.8l3.6-2.4" fill="none" />
          <ellipse cx="10" cy="6.2" rx="2.5" ry="4.9" fill={fill} />
          <ellipse cx="4.6" cy="8.4" rx="2.2" ry="4.3" fill={fill} transform="rotate(-30 4.6 8.4)" />
          <ellipse cx="15.4" cy="8.4" rx="2.2" ry="4.3" fill={fill} transform="rotate(30 15.4 8.4)" />
        </svg>
      )
    case 'brick': // two courses in a running bond
      return (
        <svg {...shell}>
          <rect x="2.8" y="5.4" width="14.4" height="4.4" rx=".8" fill={fill} />
          <rect x="2.8" y="10.8" width="6.2" height="4.4" rx=".8" fill={fill} />
          <rect x="11" y="10.8" width="6.2" height="4.4" rx=".8" fill={fill} />
        </svg>
      )
    default: // ore — a faceted gem
      return (
        <svg {...shell}>
          <path d="M6.2 4.4h7.6l3.2 4.6L10 17 3 9Z" fill={fill} />
          <path d="M3 9h14M6.2 4.4 10 9l3.8-4.6M10 9v8" fill="none" />
        </svg>
      )
  }
}

export type CounterShape = 'devCard' | 'knight' | 'vpCard'

/**
 * A tracked stat with no piece of its own. Drawn as a filled silhouette over
 * the same ink outline as the board pieces, so a tally row reads as one set of
 * icons rather than pieces plus line art.
 */
export function CounterGlyph({ shape, color = GLYPH_MUTED }: { shape: CounterShape; color?: string }) {
  const shell = {
    className: 'stat-icon',
    viewBox: '0 0 20 20',
    fill: color,
    stroke: PIECE_INK,
    strokeWidth: LINE_STROKE,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
  }
  switch (shape) {
    case 'devCard': // a card with its top corner turned back
      return (
        <svg {...shell}>
          <path d="M4.9 2.9h6.6l3.6 3.6v10.6H4.9Z" />
          <path d="M11.5 2.9v3.6h3.6" fill="none" />
        </svg>
      )
    case 'knight': // shield — also the largest-army badge. A visored helmet was
      // the first draft; at 13px it collapsed into a padlock silhouette.
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
