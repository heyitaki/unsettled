import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { analyzeBoardCached, type Recommendation } from '../engine/analyze'
import { placeBuilding, setMe } from '../model/board'
import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import type { Board, Resource, VertexId } from '../model/types'
import { recommendationMarks } from './analysisMarks'
import { readableInk } from './colors'
import { PencilGlyph, PhotoGlyph, ResourceGlyph, StructureGlyph } from './glyphs'
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
  | { kind: 'hex'; resource: Resource; number: number | null }
  | { kind: 'word'; word: 'Desert' | 'Unassigned' }
  | { kind: 'port'; resource: Resource | null; rate: number }

function vertexParts(board: Board, vertexId: VertexId): VertexPart[] {
  const touching = new Set(vertexTouchingHexes(vertexId).map(axialKey))
  const hexes = board.hexes
    .filter((hex) => touching.has(axialKey(hex.coord)))
    .map((hex): VertexPart => {
      if (hex.tile === 'desert') return { kind: 'word', word: 'Desert' }
      if (hex.tile === null) return { kind: 'word', word: 'Unassigned' }
      return { kind: 'hex', resource: hex.tile, number: hex.numberToken }
    })
  const ports = board.ports
    .filter((port) => edgeEndpointVertexIds(port.edgeId).includes(vertexId))
    .map((port): VertexPart => ({ kind: 'port', resource: port.resource, rate: port.rate }))
  return [...hexes, ...ports]
}

/** The vertex in words, for tooltips and accessible names. */
function vertexDescription(board: Board, vertexId: VertexId): string {
  return vertexParts(board, vertexId).map((part) => {
    if (part.kind === 'word') return part.word
    if (part.kind === 'hex') return `${RESOURCE_LABELS[part.resource]} ${part.number ?? '?'}`
    return part.resource === null ? `${part.rate}:1 port` : `${RESOURCE_LABELS[part.resource]} ${part.rate}:1 port`
  }).join(' · ')
}

/**
 * The vertex as glyphs (spec D4): each hex is its resource card beside its
 * number, a port its anchor (or its resource card) beside the rate, so a triple
 * and the follow-up line read at a glance and fit one line.
 */
function VertexLabel({ board, vertexId }: { board: Board; vertexId: VertexId }) {
  return (
    <>
      {vertexParts(board, vertexId).map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ' · '}
          {part.kind === 'word' ? part.word : (
            <span className="hex-label">
              {part.kind === 'hex' ? <ResourceGlyph resource={part.resource} />
                : part.resource === null ? <StructureGlyph shape="port" color="currentColor" size={12} />
                  : <ResourceGlyph resource={part.resource} />}
              {part.kind === 'hex' ? part.number ?? '?' : `${part.rate}:1`}
            </span>
          )}
        </Fragment>
      ))}
    </>
  )
}

/** React children joined by a separator, the way `Array.join` joins strings. */
function joined(items: ReactNode[], separator: string): ReactNode {
  return items.map((item, index) => (
    <Fragment key={index}>{index > 0 && separator}{item}</Fragment>
  ))
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

/**
 * The ranked picks (mobile spec S5, desktop D4). One rendering for every
 * pointer and both trees: a click or a tap selects a card, which pins its marks
 * on the board and opens the actions under it, and a fine pointer previews a
 * card's marks on hover while nothing is pinned. Placing is never a side effect
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
  const analysis = analyzeBoardCached(board)
  const recommendations = analysis.recommendations.slice(0, LISTED_PICKS)
  const [selectedPick, setSelectedPick] = useState<VertexId | null>(null)
  const [selectedLikelyGone, setSelectedLikelyGone] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // The marks this panel last put on the board. A click elsewhere (the ribbon
  // marking a pick) replaces them, and the selection that drew them has to drop
  // with them rather than sit on a card whose marks are gone.
  const own = useRef<readonly HighlightMark[] | null>(null)
  const mark = (marks: HighlightMark[] | null) => {
    own.current = marks
    dispatch({ type: 'highlight', marks })
  }
  // Marks put up by anyone else (a ribbon slot) count as pinned too: both write
  // the one highlight slot, so a hover here would otherwise take the ribbon's
  // selection with it.
  const pinned = selectedPick !== null
    || selectedLikelyGone
    || (state.highlight !== null && state.highlight !== own.current)
  // A hover is a preview, not a choice: it paints only while nothing is pinned
  // (spec DB2). A tap's compatibility mouseenter is harmless, since the click
  // that follows selects the very card the preview just painted.
  const preview = (marks: HighlightMark[] | null) => {
    if (!pinned) mark(marks)
  }

  const me = board.players.find((player) => player.id === board.mePlayerId)
  const myColor = me?.color ?? '#8a7a63'

  // Reset the board marks whenever the board changes: after a placement, the
  // previous window's circles are stale. The shell's resting marks show through
  // the cleared highlight (spec S5).
  useEffect(() => {
    setSelectedPick(null)
    setSelectedLikelyGone(false)
    own.current = null
    dispatch({ type: 'highlight', marks: null })
    return () => dispatch({ type: 'highlight', marks: null })
  }, [board, dispatch])
  useEffect(() => {
    if (state.highlight === own.current) return
    setSelectedPick(null)
    setSelectedLikelyGone(false)
  }, [state.highlight])

  const playerColor = (id: string) =>
    board.players.find((player) => player.id === id)?.color ?? '#8a7a63'
  const clearHighlight = () => mark(null)

  const pickText = analysis.draft.myPickIndices.map((index) => index + 1).join(' and ')
  const yourTurn = me !== undefined && analysis.draft.currentPlayerId === me.id
  // The picks that fall before my next turn, taken from the modal simulation, so
  // each spot is mutually legal and attributed to the player who takes it.
  const likelyGone = analysis.takenBeforeFirstPick
  // Numbered in draft order and tinted to each picker so selecting shows who goes
  // where, and playing them out puts those settlements on the board (advancing the
  // draft to my turn, or between my two picks).
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
    if (board.mePlayerId === null) return
    let next = board
    for (const { vertexId, playerId } of likelyGone) {
      if (playerId) next = placeBuilding(next, vertexId, playerId, 'settlement')
    }
    dispatch({
      type: 'commit',
      board: placeBuilding(next, recommendation.firstPick, board.mePlayerId, 'settlement'),
    })
    setSelectedPick(null)
    clearHighlight()
  }
  const selectRecommendation = (recommendation: Recommendation) => {
    const next = selectedPick === recommendation.firstPick ? null : recommendation.firstPick
    setSelectedPick(next)
    setSelectedLikelyGone(false)
    mark(next === null ? null : recommendationMarks(recommendation, myColor))
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

  const emptyMessage: Partial<Record<typeof analysis.status, string>> = {
    'no-availability': 'No spot is likely to survive until your pick.',
    'no-production': 'Add number tokens to the board to analyze placements.',
    complete: 'The draft is finished. Every starting settlement is placed.',
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
        <p className="analysis-warning">Only one player on the board.</p>
      )}
    </>
  )

  const body = analysis.status !== 'ready' ? (
    <div className="analysis-placeholder">
      <p>{emptyMessage[analysis.status]}</p>
      {analysis.status === 'no-availability' && likelyGone.length > 0 && (
        <span>
          likely gone: {joined(likelyGone.map(({ vertexId }) =>
            <VertexLabel key={vertexId} board={board} vertexId={vertexId} />), ', ')}
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
            <span className="analysis-likely-gone-title">Likely gone before your turn</span>
            {joined(likelyGone.map(({ vertexId, playerId, frequency }, index) => {
              const name = board.players.find((player) => player.id === playerId)?.name ?? 'Someone'
              return (
                <Fragment key={vertexId}>
                  {index + 1}. {name}: <VertexLabel board={board} vertexId={vertexId} /> {Math.round(frequency * 100)}%
                </Fragment>
              )
            }), ' · ')}
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
      <div className="analysis-list" onMouseLeave={() => preview(null)}>
        {recommendations.map((recommendation, index) => {
          const factors = displayedFactors(recommendation)
          const current = selectedPick === recommendation.firstPick
          // The desktop list is collapsed: a row is its pick line, score and
          // follow-up until it is selected, and the factors open with it. The
          // phone card carries everything at rest (mobile spec S5).
          const expanded = onBuild !== undefined || current
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
                onMouseEnter={() => preview(recommendationMarks(recommendation, myColor))}
              >
                <span
                  className="analysis-rank"
                  style={{ background: myColor, color: readableInk(myColor) }}
                >
                  {index + 1}
                </span>
                <span className="analysis-row-body">
                  <span className="analysis-pick-line">
                    <strong><VertexLabel board={board} vertexId={recommendation.firstPick} /></strong>
                    <span className="analysis-score">{recommendation.score.toFixed(1)}</span>
                  </span>
                  {recommendation.survival < 1 && (
                    <span className="analysis-availability">
                      {Math.round(recommendation.survival * 100)}% likely available
                    </span>
                  )}
                  {recommendation.plannedSecond.length > 0 && (
                    <span className="analysis-second">
                      then: {joined(recommendation.plannedSecond
                        .map((vertexId) => <VertexLabel key={vertexId} board={board} vertexId={vertexId} />), ' or ')}
                    </span>
                  )}
                  {expanded && (
                    <span className="analysis-factors">
                      {factors.map(([label, value]) => (
                        <span key={label}>{label} {formatFactor(value)}</span>
                      ))}
                    </span>
                  )}
                </span>
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
  return (
    <section className={className}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{empty ? 'Nothing to rank yet' : 'Draft analysis'}</span>
          <h2>{empty ? 'This board is empty' : 'Best picks'}</h2>
        </div>
        {!empty && yourTurn && <span className="turn-pill"><i />Your turn</span>}
      </div>
      {empty ? (
        <div className="claim">
          <p className="hint">
            Nothing has been laid out yet. Import a screenshot and the parser reads the tiles,
            numbers and players off it, or place them yourself.
          </p>
          {/* The desktop's import and tools are already on screen in the left
              rail, so only the phone needs the two ways in from here (spec D4). */}
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
      ) : !me ? (
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
          <p className="analysis-context">
            You are{' '}
            <MenuSelect
              ariaLabel="Which player is you"
              value={board.mePlayerId}
              options={board.players.map((player) => ({ value: player.id, label: player.name }))}
              onSelect={claim}
            >
              <strong>{me.name}</strong>
            </MenuSelect>
            {` · picking ${pickText} of ${analysis.draft.sequence.length}`}
          </p>
          {warnings}
          {body}
        </>
      )}
      {/* Outside the empty branch: a successful import replaces the board
          and drops that branch, and the dialog must outlive it to show any
          parse issues. */}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </section>
  )
}
