import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Recommendation } from '../engine/analyze'
import { draftIsComplete } from '../engine/draft'
import { isRedToken, placeBuilding, setMe } from '../model/board'
import { axialKey, axialToPixel, edgeEndpointVertexIds, parseEdgeId, parseVertexId } from '../model/coords'
import type { AxialCoord, Board, Resource, TileKind, VertexId } from '../model/types'
import { recommendationMarks } from './analysisMarks'
import { useAnalysis } from './useAnalysis'
import { useDraftSteps } from './useDraftSteps'
import { BLANK_TILE_COLOR, INK_COLOR, readableInk, TILE_COLORS, TOKEN_COLOR } from './colors'
import { DraftRibbon } from './DraftRibbon'
import { viewedPlayerId } from './draftSlots'
import { BestMovesPanel } from './BestMovesPanel'
import { ArrowLeftGlyph, ArrowRightGlyph, DesertGlyph, PencilGlyph, PhotoGlyph } from './glyphs'
import { ImportDialog } from './ImportDialog'
import { MenuSelect } from './MenuSelect'
import { LISTED_PICKS } from './restMarks'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore, type HighlightMark } from './store'

const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

/** What a vertex touches: its hexes, then any port on an edge it ends. */
type VertexPart =
  | { kind: 'hex'; coord: AxialCoord; tile: TileKind | null; number: number | null }
  | { kind: 'port'; coord: AxialCoord; tile: Resource | null; rate: number }

function vertexParts(board: Board, vertexId: VertexId): VertexPart[] {
  const touching = new Set(parseVertexId(vertexId).map(axialKey))
  const land = new Set(board.hexes.map((hex) => axialKey(hex.coord)))
  const hexes = board.hexes
    .filter((hex) => touching.has(axialKey(hex.coord)))
    .map((hex): VertexPart => ({ kind: 'hex', coord: hex.coord, tile: hex.tile, number: hex.numberToken }))
  const ports = board.ports
    .filter((port) => edgeEndpointVertexIds(port.edgeId).includes(vertexId))
    .map((port): VertexPart => {
      const edge = parseEdgeId(port.edgeId)
      const coord = edge.find((member) => !land.has(axialKey(member))) ?? edge[0]
      return { kind: 'port', coord, tile: port.resource, rate: port.rate }
    })
  return [...hexes, ...ports]
}

/** The vertex in words, for tooltips and accessible names. */
function vertexDescription(board: Board, vertexId: VertexId): string {
  return vertexParts(board, vertexId).map((part) => {
    if (part.kind === 'hex') {
      if (part.tile === 'desert') return 'Desert'
      if (part.tile === null) return 'Unassigned'
      return `${RESOURCE_LABELS[part.tile]} ${part.number ?? '?'}`
    }
    return part.tile === null ? `${part.rate}:1 port` : `${RESOURCE_LABELS[part.tile]} ${part.rate}:1 port`
  }).join(' · ')
}

const PICK_TILE_SIDE = 14
const SMALL_TILE_SIDE = 11.5

function SpotTiles({ board, vertexId, small = false }: { board: Board; vertexId: VertexId; small?: boolean }) {
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

function formatFactor(value: number): string {
  const magnitude = Math.abs(value).toFixed(1)
  return value < 0 ? `−${magnitude}` : `+${magnitude}`
}

function displayedFactors(recommendation: Recommendation): readonly [string, number][] {
  const factors: [string, number][] = [
    ['Production', recommendation.breakdown.production],
    ['Scarcity', recommendation.breakdown.scarcity],
    ['Balance', recommendation.breakdown.diversity],
    ['Port', recommendation.breakdown.port],
    ['Robber', recommendation.breakdown.robber],
    ['Expansion', recommendation.breakdown.expansion],
    ['Hand', recommendation.breakdown.handValue],
  ]
  const tenths = factors.map(([label, value]) => [label, Math.round(value * 10)] as [string, number])
  const target = Math.round(recommendation.score * 10)
  const displayedTotal = tenths.reduce((sum, [, value]) => sum + value, 0)
  const adjustmentIndex = tenths.reduce(
    (best, [, value], index) => Math.abs(value) > Math.abs(tenths[best][1]) ? index : best,
    0,
  )
  tenths[adjustmentIndex][1] += target - displayedTotal
  return tenths
    .filter(([, value]) => value !== 0)
    .map(([label, value]) => [label, value / 10])
}

/** No hex carries a tile (spec B5): there is nothing to rank, only ways to fill the board. */
const boardIsEmpty = (board: Board): boolean => board.hexes.every((hex) => hex.tile === null)

const ordinal = (pick: number): string => `${pick}${['st', 'nd', 'rd'][pick - 1] ?? 'th'}`

/**
 * The ranked picks (mobile spec S5, desktop D4). One rendering for every
 * pointer and both trees: a click or a tap selects a row, which pins its marks
 * on the board and opens the actions under it, and a fine pointer previews a
 * row's marks on hover while nothing is pinned. Placing is never a side effect
 * of selecting.
 *
 * Only the phone shell passes `onBuild`, so that prop also tells the trees apart
 * where they still differ: the build handoff, the hint's verb, and the scroll
 * back to a board the one-document page has run past.
 */
export function AnalysisPanel({ className = 'panel analysis-panel', onBuild }: {
  className?: string
  onBuild?: () => void
} = {}) {
  const { state, dispatch } = useStore()
  const board = activeTab(state).game.board
  const { analysis, pending, settled, progress = 0, error, retry } = useAnalysis()
  const { canStepBack, canStepForward, stepBack, stepForward } = useDraftSteps()
  // While a ranking is pending the last one stays in place, inert and drawn as
  // placeholders, so the panel keeps its height (spec D4). The draft facts
  // still come from `analysis`, which is already the new board's. Only a body
  // that was on screen has a shape to keep: the ref is set while it is mounted,
  // which the empty board, the claim row and an error all leave it not.
  const bodyRef = useRef<HTMLDivElement>(null)
  const stale = pending && settled && bodyRef.current ? settled : null
  const shown = stale ?? analysis
  // With no body to hold (first load, a fresh claim) generic rows stand in, but
  // only where a ranking can follow: a board with no numbers or a player with
  // no pick left answers at once with a message, and rows would only flash.
  const ghosts = pending && !stale
    && board.hexes.some((hex) => hex.numberToken !== null)
    && analysis.draft.myRemainingPickIndices.length > 0
  const recommendations = shown.recommendations.slice(0, LISTED_PICKS)
  const [selectedPick, setSelectedPick] = useState<VertexId | null>(null)
  const [selectedLikelyGone, setSelectedLikelyGone] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // External highlights, such as import issues, replace the selected row's marks.
  const own = useRef<readonly HighlightMark[] | null>(null)
  const mark = (marks: HighlightMark[] | null) => {
    own.current = marks
    dispatch({ type: 'highlight', marks })
  }

  // Hover must leave highlights from other panels in place.
  const pinned = selectedPick !== null
    || selectedLikelyGone
    || (state.highlight !== null && state.highlight !== own.current)
  // A hover is a preview, not a choice: it paints only while nothing is pinned
  // (spec DB2). A tap's compatibility mouseenter is harmless, since the click
  // that follows selects the very row the preview just painted.
  const preview = (marks: HighlightMark[] | null) => {
    if (!pinned) mark(marks)
  }

  const playerId = viewedPlayerId(board, state.viewedPick)
  const viewedPlayer = board.players.find((player) => player.id === playerId)
  const viewedColor = viewedPlayer?.color ?? '#8a7a63'

  // Reset the board marks whenever the board or viewed pick changes: the
  // previous window's circles are stale. The shell's resting marks show through
  // the cleared highlight (spec S5). A layout effect, so the next ranking is
  // never painted with the last one's row still open.
  useLayoutEffect(() => {
    setSelectedPick(null)
    setSelectedLikelyGone(false)
    own.current = null
    dispatch({ type: 'highlight', marks: null })
    return () => dispatch({ type: 'highlight', marks: null })
  }, [board, state.viewedPick, dispatch])
  useEffect(() => {
    if (state.highlight === own.current) return
    setSelectedPick(null)
    setSelectedLikelyGone(false)
  }, [state.highlight])

  const playerColor = (id: string) =>
    board.players.find((player) => player.id === id)?.color ?? '#8a7a63'
  const clearHighlight = () => mark(null)

  const pickText = state.viewedPick == null || state.viewedPick === analysis.draft.myRemainingPickIndices[0]
    ? analysis.draft.myPickIndices.map((index) => ordinal(index + 1)).join(' and ')
    : ordinal(state.viewedPick + 1)
  // The picks before the viewed pick, taken from the modal simulation, so
  // each spot is mutually legal and attributed to the player who takes it.
  const likelyGone = shown.takenBeforeFirstPick
  // Numbered in draft order and tinted to each picker so selecting shows who goes
  // where, and playing them out advances the draft to the viewed pick.
  const likelyGoneMarks: HighlightMark[] = likelyGone.map(({ vertexId, playerId }, index) => ({
    ref: vertexId,
    color: playerColor(playerId),
    label: String(index + 1),
  }))
  const placeLikelyGone = () => {
    let next = board
    for (const { vertexId, playerId } of likelyGone) {
      if (playerId) next = placeBuilding(next, vertexId, playerId, 'settlement')
    }
    if (next !== board) dispatch({ type: 'commit', board: next })
    setSelectedLikelyGone(false)
    clearHighlight()
  }
  const placeRecommendation = (recommendation: Recommendation) => {
    if (playerId === null) return
    let next = board
    for (const { vertexId, playerId } of likelyGone) {
      if (playerId) next = placeBuilding(next, vertexId, playerId, 'settlement')
    }
    dispatch({
      type: 'commit',
      board: placeBuilding(next, recommendation.firstPick, playerId, 'settlement'),
    })
    setSelectedPick(null)
    clearHighlight()
  }
  const selectRecommendation = (recommendation: Recommendation) => {
    const next = selectedPick === recommendation.firstPick ? null : recommendation.firstPick
    setSelectedPick(next)
    setSelectedLikelyGone(false)
    mark(next === null ? null : recommendationMarks(recommendation, viewedColor))
    // A mark moved on a board scrolled out of view is a change nobody sees
    // (spec B2), and only the phone's one document can scroll past the board.
    if (onBuild && next !== null) revealBoardIfScrolledPast()
  }
  const selectLikelyGone = () => {
    const next = !selectedLikelyGone
    setSelectedLikelyGone(next)
    setSelectedPick(null)
    mark(next ? likelyGoneMarks : null)
  }
  const claim = (playerId: string) => dispatch({ type: 'commit', board: setMe(board, playerId) })
  const viewPlayer = (playerId: string) => {
    const slot = analysis.draft.remainingPickIndices.find((index) => analysis.draft.sequence[index] === playerId)
    if (slot !== undefined) dispatch({ type: 'view-pick', slot })
  }

  const emptyMessage: Partial<Record<typeof analysis.status, string>> = {
    'no-availability': 'No spot is likely to survive until this pick.',
    'no-production': 'Add number tokens to the board to analyze placements.',
    'me-done': 'Your starting settlements are placed. Waiting on the rest of the draft.',
  }

  const warnings = (
    <>
      {analysis.warnings.includes('snake-inconsistent') && (
        <p className="analysis-warning">
          Placed settlements don't match a clean snake draft, so recommendations are best-effort.
        </p>
      )}
      {analysis.warnings.includes('solo-roster') && (
        <p className="analysis-warning quiet">Only one player on the board.</p>
      )}
    </>
  )

  const body = shown.status !== 'ready' ? (
    <div className="analysis-placeholder">
      <p>{emptyMessage[shown.status]}</p>
      {shown.status === 'no-availability' && likelyGone.length > 0 && (
        <span className="analysis-gone-spots">
          likely gone:
          {likelyGone.map(({ vertexId }) => <SpotTiles key={vertexId} board={board} vertexId={vertexId} small />)}
        </span>
      )}
    </div>
  ) : (
    <>
      {likelyGone.length > 0 && (
        <div
          className={`analysis-likely-gone ${selectedLikelyGone ? 'current' : ''}`}
          onMouseLeave={() => preview(null)}
        >
          <button
            type="button"
            className="analysis-touch-select"
            onClick={selectLikelyGone}
            onMouseEnter={() => preview(likelyGoneMarks)}
          >
            <span className="analysis-likely-gone-title">Likely gone before this pick</span>
            <span className="analysis-gone-entries">
              {likelyGone.map(({ vertexId, playerId, frequency }, index) => {
                const name = board.players.find((player) => player.id === playerId)?.name ?? 'Someone'
                return (
                  <span key={vertexId} className="analysis-gone-entry">
                    <span>{index + 1}. {name}</span>
                    <SpotTiles board={board} vertexId={vertexId} small />
                    <span>{Math.round(frequency * 100)}%</span>
                  </span>
                )
              })}
            </span>
          </button>
          {selectedLikelyGone && (
            <div className="analysis-touch-actions">
              <button type="button" className="primary" onClick={placeLikelyGone}>Play these out</button>
              <button
                type="button"
                onClick={() => {
                  setSelectedLikelyGone(false)
                  clearHighlight()
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
      <div className="analysis-list pick-ledger" onMouseLeave={() => preview(null)}>
        {recommendations.map((recommendation, index) => {
          const factors = displayedFactors(recommendation)
          const current = selectedPick === recommendation.firstPick
          return (
            <div
              key={recommendation.firstPick}
              className={`analysis-row ${current ? 'current' : ''}`}
            >
              <button
                type="button"
                className="analysis-row-select"
                title={vertexDescription(board, recommendation.firstPick)}
                onClick={() => selectRecommendation(recommendation)}
                onMouseEnter={() => preview(recommendationMarks(recommendation, viewedColor))}
              >
                <span
                  className="analysis-rank"
                  style={{ background: viewedColor, color: readableInk(viewedColor) }}
                >
                  {index + 1}
                </span>
                <SpotTiles board={board} vertexId={recommendation.firstPick} />
                <span className="analysis-row-body">
                  {recommendation.survival < 1 && (
                    <span className="analysis-availability">
                      {Math.round(recommendation.survival * 100)}% likely available
                    </span>
                  )}
                  {recommendation.plannedSecond.length > 0 && (
                    <span className="analysis-follow">
                      {recommendation.plannedSecond.map((vertexId, index) => (
                        <span key={vertexId} className="analysis-follow-spot">
                          <span>{index === 0 ? 'then' : 'or'}</span>
                          <SpotTiles board={board} vertexId={vertexId} small />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="analysis-score">{recommendation.score.toFixed(1)}</span>

                {/* Both trees show factors only for the selected row. */}
                {current && (
                  <span className="analysis-factors">
                    {factors.map(([label, value]) => (
                      <span key={label}>{label} <b>{formatFactor(value)}</b></span>
                    ))}
                  </span>
                )}
              </button>
              {current && (
                <div className="analysis-touch-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => placeRecommendation(recommendation)}
                  >
                    Place settlement
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPick(null)
                      clearHighlight()
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  const empty = boardIsEmpty(board)
  const panel = (
    <section className={className}>
      <div className="panel-heading">
        <h2>{empty ? 'This board is empty' : 'Best picks'}</h2>
        {!empty && (
          <div className="panel-actions">
            <button type="button" className="panel-dots" aria-label="Step back one pick" data-label="Back" disabled={!canStepBack} onClick={stepBack}>
              <ArrowLeftGlyph />
            </button>
            <button type="button" className="panel-dots" aria-label="Step forward one pick" data-label="Forward" disabled={!canStepForward} onClick={stepForward}>
              <ArrowRightGlyph />
            </button>
          </div>
        )}
      </div>
      {!empty && <DraftRibbon />}
      {empty ? (
        <div className="claim">
          <p className="hint">
            Import a screenshot to read the tiles, numbers and players off it, or place them yourself.
          </p>
          {/* The desktop's import button and `Edit manually` fold are already on screen
              in the left rail, so only the phone needs the two ways in from here (spec D4). */}
          {onBuild && (
            <div className="empty-actions">
              <button type="button" className="primary" onClick={() => setImportOpen(true)}>
                <PhotoGlyph />
                Import screenshot
              </button>
              <button type="button" onClick={onBuild}>
                <PencilGlyph />
                Build it by hand
              </button>
            </div>
          )}
        </div>
      ) : board.mePlayerId === null ? (
        <div className="claim">
          <p className="hint">{onBuild ? 'Tap' : 'Pick'} your colour and the ranking starts.</p>
          <div className="claim-row">
            {board.players.map((player) => (
              <button type="button" key={player.id} onClick={() => claim(player.id)}>
                <span className="swatch" style={{ background: player.color }} />
                {player.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="analysis-context">
            <MenuSelect
              ariaLabel="Whose picks to show"
              value={playerId}
              options={board.players
                .filter((player) => player.id === playerId || analysis.draft.remainingPickIndices
                  .some((index) => analysis.draft.sequence[index] === player.id))
                .map((player) => ({ value: player.id, label: player.name }))}
              onSelect={viewPlayer}
            >
              <strong>{viewedPlayer?.name}</strong>
            </MenuSelect>
            {` · Picking ${pickText}`}
          </div>
          {warnings}
          <div className="analysis-body">
            {pending && (
              <div className="analysis-loading" role="status">
                <span>Analyzing placements…</span>
                {/* Never empty, so the bar reads as started before the first report. */}
                <div style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
              </div>
            )}
            {!pending && error ? (
              <div role="alert">
                <p>{error}</p>
                <button type="button" onClick={retry}>Retry analysis</button>
              </div>
            ) : (!pending || stale) ? (
              <div ref={bodyRef} className={pending ? 'analysis-stale' : undefined} inert={pending}>{body}</div>
            ) : ghosts && (
              <div className="analysis-ghosts pick-ledger" aria-hidden>
                {Array.from({ length: LISTED_PICKS }, (_, index) => (
                  <div key={index} className="analysis-ghost"><span /><span /><span /><span /></div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
  // The dialog is the panel's sibling at a fixed position: a successful import replaces the
  // board, which drops the empty branch or swaps the whole panel for Best moves, and the
  // dialog must outlive both to show any parse issues.
  return (
    <>
      {!empty && draftIsComplete(board, analysis.draft) ? <BestMovesPanel className={className} /> : panel}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  )
}
