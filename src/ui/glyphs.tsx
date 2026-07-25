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

// Relative scale reads as tiers: settlement < city < super city. Port gets a
// bump because its silhouette carries a lot of empty margin.
const PIECE_SCALE: Record<string, number> = {
  settlement: 17 / 19,
  city: 21 / 19,
  superCity: 23 / 19,
  port: 22 / 19,
}

export type StructureShape =
  | 'road' | 'settlement' | 'city' | 'superCity' | 'robber' | 'port' | 'erase'

/**
 * A board piece silhouette. `size` is the px box for a shape of scale 1; the
 * per-shape scale above then keeps the tiers visually ordered at any size.
 * Pass `uniform` to drop that scaling — a heading strip wants one height for
 * every icon, not settlement < city < super city.
 */
export function StructureGlyph({ shape, color, size = 19, uniform = false }: {
  shape: StructureShape
  color: string
  size?: number
  uniform?: boolean
}) {
  const box = uniform ? size : size * (PIECE_SCALE[shape] ?? 1)
  const style = { width: box, height: box }
  switch (shape) {
    case 'road':
      // Two rects, not a stroked one: the board draws an ink casing around a
      // colored core (BoardCanvas ROAD_CORE/ROAD_RADIUS), and the proportions
      // are copied from it — long, slim, and squared off rather than a capsule.
      return (
        <svg className="tool-icon" style={style} viewBox="0 0 20 20" aria-hidden="true">
          <g transform="rotate(-38 10 10)">
            <rect x="0.6" y="7.5" width="18.8" height="5" rx="2.1" fill={PIECE_INK} />
            <rect x="1.5" y="8.4" width="17" height="3.2" rx="1.1" fill={color} />
          </g>
        </svg>
      )
    case 'settlement':
      return (
        <svg className="tool-icon" style={style} viewBox="-18 -18 36 36" aria-hidden="true">
          <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" fill={color} stroke={PIECE_INK} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'city':
      return (
        <svg className="tool-icon" style={style} viewBox="-16 -17 37 34" aria-hidden="true">
          <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" fill={color} stroke={PIECE_INK} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case 'superCity':
      return (
        <svg className="tool-icon" style={style} viewBox="-16 -13 32 27" aria-hidden="true">
          <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" fill={color} stroke={PIECE_INK} strokeWidth="2" strokeLinejoin="round" />
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
          style={{ ...style, fill: 'none' }}
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

/** A hand resource: terrain-coloured body over the shared ink outline. */
export function ResourceGlyph({ resource }: { resource: Resource }) {
  const fill = TILE_COLORS[resource]
  const shell = {
    className: 'stat-icon',
    viewBox: '0 0 20 20',
    stroke: PIECE_INK,
    strokeWidth: 1.1,
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
    strokeWidth: 1.4,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
  }
  switch (shape) {
    case 'devCard': // a card with its top corner turned back
      return (
        <svg {...shell}>
          <path d="M4.9 2.9h6.6l3.6 3.6v10.6H4.9Z" />
          <path d="M11.5 2.9v3.6h3.6" fill="none" strokeWidth="1.2" />
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
