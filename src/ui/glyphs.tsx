import { isRedToken, pips } from '../model/board'
import type { Resource } from '../model/types'
import { INK_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'

// Shared inline icons, one flat family on a 20-unit grid (desktop spec D3,
// option C): pieces are filled blocks of a player or tool colour with no
// casing, counters and resources are filled silhouettes at the same weight, and
// the line-art marks (anchor, trash) are drawn thick enough to sit beside them.
// The board keeps its own piece shapes; only the robber's outline and the
// number token's face are shared.

const PIECE_INK = '#30271f'
/** The paper the cut-out detail of a flat glyph shows through. */
const PAPER = '#fbf8f1'
/**
 * Default body colour for glyphs with no player/tool colour of their own: the
 * page's icon grey (--glyph in editor.css), a step lighter than muted text
 * because a filled shape reads heavier than lettering in the same colour.
 */
export const GLYPH_MUTED = '#8e867a'

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
          {/* The board's road: a plank lying along a hex edge. */}
          <rect x="1.5" y="8.2" width="17" height="3.6" rx="1.3" transform="rotate(-30 10 10)" fill={color} />
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

/** A token's probability pips, centred under (x, y) in board units. */
export function TokenPips({ number, x, y, override }: { number: number; x: number; y: number; override?: { fill: string; stroke: string } }) {
  const count = pips(number)
  const fill = override?.fill ?? (isRedToken(number) ? '#af2020' : INK_COLOR)
  return Array.from({ length: count }, (_, index) => (
    <circle
      key={index}
      cx={x + (index - (count - 1) / 2) * 4.2}
      cy={y + 12}
      r="1.6"
      fill={fill}
      stroke={override?.stroke}
      strokeWidth={override ? 0.8 : undefined}
    />
  ))
}

const TOKEN_RADIUS = 23
const TOKEN_STROKE = 2.5
/** The token's outer radius in board units, stroke included: half the box a lone token needs. */
export const NUMBER_TOKEN_EXTENT = TOKEN_RADIUS + TOKEN_STROKE / 2

/**
 * A number token in board units, centred on (x, y). The board and the tools
 * palette both draw this one face, so the palette's tokens keep the board's
 * proportions at any size.
 */
export function NumberTokenFace({ number, x = 0, y = 0, discOnly = false }: {
  number: number
  x?: number
  y?: number
  /** The disc without its number and pips. */
  discOnly?: boolean
}) {
  return (
    <>
      <circle className="token-disc" cx={x} cy={y} r={TOKEN_RADIUS} fill={TOKEN_COLOR} stroke={INK_COLOR} strokeWidth={TOKEN_STROKE} />
      {!discOnly && (
        <>
          <text x={x} y={y + 6} textAnchor="middle" className={isRedToken(number) ? 'token-text hot' : 'token-text'}>{number}</text>
          <TokenPips number={number} x={x} y={y} />
        </>
      )}
    </>
  )
}

export type CounterShape = 'unknownCard' | 'devCard' | 'knight' | 'vpCard'

/** A tracked stat with no piece of its own, filled flat like the pieces. */
export function CounterGlyph({ shape }: { shape: CounterShape }) {
  const shell = {
    className: 'stat-icon',
    viewBox: GRID,
    fill: GLYPH_MUTED,
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
    case 'knight': // shield
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

export function PlusGlyph() {
  return (
    <svg {...LINE_ART} width="15" height="15" viewBox="0 0 12 12" strokeWidth="1.4">
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

export function ArrowLeftGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 20 20" strokeWidth="1.7">
      <path d="M16 10H4" />
      <path d="M9 5 4 10l5 5" />
    </svg>
  )
}

export function ArrowRightGlyph() {
  return (
    <svg {...LINE_ART} width="16" height="16" viewBox="0 0 20 20" strokeWidth="1.7">
      <path d="M4 10h12" />
      <path d="M11 5l5 5-5 5" />
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
