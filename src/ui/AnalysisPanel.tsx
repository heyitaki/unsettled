import { useEffect, useRef, useState } from 'react'
import { analyzeBoardCached, type Recommendation } from '../engine/analyze'
import { placeBuilding, setMe } from '../model/board'
import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import type { Board, Resource, VertexId } from '../model/types'
import { readableInk } from './colors'
import { PencilGlyph, PhotoGlyph } from './glyphs'
import { ImportDialog } from './ImportDialog'
import { MenuSelect } from './MenuSelect'
import { LISTED_PICKS } from './restMarks'
import { revealBoardIfScrolledPast } from './revealBoard'
import { activeTab, useStore, type HighlightMark } from './store'
import { useCoarsePointer } from './useMediaQuery'

const RESOURCE_LABELS: Record<Resource, string> = {
  wood: 'Wood',
  sheep: 'Sheep',
  wheat: 'Wheat',
  brick: 'Brick',
  ore: 'Ore',
}

function vertexDescription(board: Board, vertexId: VertexId): string {
  const touching = new Set(vertexTouchingHexes(vertexId).map(axialKey))
  const hexes = board.hexes
    .filter((hex) => touching.has(axialKey(hex.coord)))
    .map((hex) => {
      if (hex.tile === 'desert') return 'Desert'
      if (hex.tile === null) return 'Unassigned'
      return `${RESOURCE_LABELS[hex.tile]} ${hex.numberToken ?? '?'}`
    })
  const ports = board.ports
    .filter((port) => edgeEndpointVertexIds(port.edgeId).includes(vertexId))
    .map((port) => port.resource === null
      ? `${port.rate}:1 port`
      : `${RESOURCE_LABELS[port.resource]} ${port.rate}:1 port`)
  return [...hexes, ...ports].join(' · ')
}

// A recommendation draws my first pick as "1" and its planned follow-up as "2",
// both in my colour, so hovering previews the pair I'd end the round holding.
// The phone sets the follow-up back: it is where the second settlement would
// go, not what the tap places (spec S5).
const recommendationMarks = (
  recommendation: Recommendation,
  color: string,
  fadedSecond = false,
): HighlightMark[] => [
  { ref: recommendation.firstPick, color, label: '1' },
  ...recommendation.plannedSecond.slice(0, 1).map((ref) => ({ ref, color, label: '2', faded: fadedSecond })),
]

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
 * The ranked picks. The desktop panel and the phone's block (spec S5) share
 * every derivation and the card list; the phone variant swaps the heading, the
 * context line and the two states the desktop shows as text: an unclaimed
 * roster becomes a row of swatches, and an empty board becomes the two ways
 * to fill it, one of which hands off to the shell's build mode.
 */
export function AnalysisPanel({ variant = 'desktop', onBuild }: {
  variant?: 'desktop' | 'phone'
  onBuild?: () => void
} = {}) {
  const { state, dispatch } = useStore()
  const phone = variant === 'phone'
  // The phone's every path works from taps alone, whatever the pointer reports.
  const coarse = useCoarsePointer() || phone
  const board = activeTab(state).game.board
  const analysis = analyzeBoardCached(board)
  const recommendations = analysis.recommendations.slice(0, LISTED_PICKS)
  const [selectedPick, setSelectedPick] = useState<VertexId | null>(null)
  const [selectedLikelyGone, setSelectedLikelyGone] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // The marks this panel last put on the board. On the phone a tap elsewhere
  // (the ribbon marking a pick) replaces them, and the selection that drew them
  // has to drop with them rather than sit on a card whose marks are gone.
  const own = useRef<readonly HighlightMark[] | null>(null)
  const mark = (marks: HighlightMark[] | null) => {
    own.current = marks
    dispatch({ type: 'highlight', marks })
  }

  const me = board.players.find((player) => player.id === board.mePlayerId)
  const myColor = me?.color ?? '#8a7a63'

  // Reset the board marks whenever the board changes: after a click places
  // settlements, the previous window's circles are stale. On the phone the
  // shell's resting marks show through the cleared highlight (spec S5).
  useEffect(() => {
    setSelectedPick(null)
    setSelectedLikelyGone(false)
    own.current = null
    dispatch({ type: 'highlight', marks: null })
    return () => dispatch({ type: 'highlight', marks: null })
  }, [board, dispatch])
  useEffect(() => {
    if (!phone || state.highlight === own.current) return
    setSelectedPick(null)
    setSelectedLikelyGone(false)
  }, [phone, state.highlight])

  const playerColor = (id: string) =>
    board.players.find((player) => player.id === id)?.color ?? '#8a7a63'
  const clearHighlight = () => mark(null)

  const pickText = analysis.draft.myPickIndices.map((index) => index + 1).join(' and ')
  const turnText = analysis.draft.turnIndex === null
    ? ''
    : analysis.draft.currentPlayerId === board.mePlayerId
      ? 'your turn'
      : `${board.players.find((player) => player.id === analysis.draft.currentPlayerId)?.name ??
        analysis.draft.currentPlayerId}'s turn`
  const contextTail = me
    ? `, picking ${pickText} of ${analysis.draft.sequence.length}${
      analysis.draft.placedCount > 0 && analysis.draft.turnIndex !== null
        ? ` · pick ${analysis.draft.turnIndex + 1} of ${analysis.draft.sequence.length}, ${turnText}`
        : ''
    }`
    : null
  // The picks that fall before my next turn, taken from the modal simulation, so
  // each spot is mutually legal and attributed to the player who takes it.
  const likelyGone = analysis.takenBeforeFirstPick
  // Numbered in draft order and tinted to each picker so hovering shows who goes
  // where, and clicking plays those settlements out on the board (advancing the
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
    mark(next === null ? null : recommendationMarks(recommendation, myColor, phone))
    // A mark moved on a board scrolled out of view is a change nobody sees (spec B2).
    if (phone && next !== null) revealBoardIfScrolledPast()
  }
  const claim = (playerId: string) => dispatch({ type: 'commit', board: setMe(board, playerId) })

  const emptyMessage: Partial<Record<typeof analysis.status, string>> = {
    'no-me': 'Pick who you are above to get recommendations.',
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
          likely gone: {likelyGone.map(({ vertexId }) =>
            vertexDescription(board, vertexId)).join(', ')}
        </span>
      )}
    </div>
  ) : (
    <>
      {likelyGone.length > 0 && (
        coarse ? (
          <div className={`analysis-likely-gone ${selectedLikelyGone ? 'selected' : ''}`}>
            <button
              type="button"
              className="analysis-touch-select"
              onClick={() => {
                const next = !selectedLikelyGone
                setSelectedLikelyGone(next)
                setSelectedPick(null)
                mark(next ? likelyGoneMarks : null)
              }}
            >
              <span>Likely gone before your turn</span>
              {likelyGone.map(({ vertexId, playerId, frequency }, index) => {
                const name = board.players.find((player) => player.id === playerId)?.name ?? 'Someone'
                return `${index + 1}. ${name}: ${vertexDescription(board, vertexId)} ${Math.round(frequency * 100)}%`
              }).join(' · ')}
            </button>
            {selectedLikelyGone && (
              <div className="analysis-touch-actions">
                <button type="button" className="primary" onClick={placeLikelyGone}>Play these out</button>
                <button
                  type="button"
                  className="analysis-clear"
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
        ) : (
          <button
            type="button"
            className="analysis-likely-gone"
            onMouseEnter={() => dispatch({ type: 'highlight', marks: likelyGoneMarks })}
            onMouseLeave={clearHighlight}
            onClick={placeLikelyGone}
          >
            <span>Likely gone before your turn (click to play out)</span>
            {likelyGone.map(({ vertexId, playerId, frequency }, index) => {
              const name = board.players.find((player) => player.id === playerId)?.name ?? 'Someone'
              return `${index + 1}. ${name}: ${vertexDescription(board, vertexId)} ${Math.round(frequency * 100)}%`
            }).join(' · ')}
          </button>
        )
      )}
      <div className="analysis-list" onMouseLeave={coarse ? undefined : clearHighlight}>
        {recommendations.map((recommendation, index) => {
          const factors = displayedFactors(recommendation)
          const content = (
            <>
              <span
                className="analysis-rank"
                style={phone ? { background: myColor, color: readableInk(myColor) } : undefined}
              >
                {index + 1}
              </span>
              <span className="analysis-row-body">
                <span className="analysis-pick-line">
                  <strong>{vertexDescription(board, recommendation.firstPick)}</strong>
                  <span className="analysis-score">{recommendation.score.toFixed(1)}</span>
                </span>
                {recommendation.survival < 1 && (
                  <span className="analysis-availability">
                    {Math.round(recommendation.survival * 100)}% likely available
                  </span>
                )}
                {recommendation.plannedSecond.length > 0 && (
                  <span className="analysis-second">
                    then: {recommendation.plannedSecond
                      .map((vertexId) => vertexDescription(board, vertexId))
                      .join(' / ')}
                  </span>
                )}
                <span className="analysis-factors">
                  {factors.map(([label, value]) => (
                    <span key={label}>{label} {formatFactor(value)}</span>
                  ))}
                </span>
              </span>
            </>
          )
          if (coarse) {
            const selected = selectedPick === recommendation.firstPick
            return (
              <div
                key={recommendation.firstPick}
                className={`analysis-row ${selected ? 'selected' : ''}`}
              >
                <button
                  type="button"
                  className="analysis-row-select"
                  onClick={() => selectRecommendation(recommendation)}
                >
                  {content}
                </button>
                {selected && (
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
                      className="analysis-clear"
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
          }
          return (
            <button
              type="button"
              key={recommendation.firstPick}
              className="analysis-row"
              onMouseEnter={() => dispatch({
                type: 'highlight',
                marks: recommendationMarks(recommendation, myColor),
              })}
              onClick={() => placeRecommendation(recommendation)}
            >
              {content}
            </button>
          )
        })}
      </div>
    </>
  )

  if (phone) {
    const empty = boardIsEmpty(board)
    const yourTurn = me !== undefined && analysis.draft.currentPlayerId === me.id
    return (
      <section className="phone-block phone-analysis">
        <div className="phone-block-head">
          <div>
            <span className="eyebrow">{empty ? 'Nothing to rank yet' : 'Draft analysis'}</span>
            <h2>{empty ? 'This board is empty' : 'Best picks'}</h2>
          </div>
          {!empty && yourTurn && <span className="phone-turn-pill"><i />Your turn</span>}
        </div>
        {empty ? (
          <div className="phone-claim">
            <p className="phone-hint">
              Nothing has been laid out yet. Import a screenshot and the parser reads the tiles,
              numbers and players off it, or place them yourself.
            </p>
            <div className="phone-empty-actions">
              <button type="button" className="primary" onClick={() => setImportOpen(true)}>
                <PhotoGlyph />
                Import screenshot
              </button>
              <button type="button" onClick={onBuild}>
                <PencilGlyph />
                Build it by hand
              </button>
            </div>
          </div>
        ) : !me ? (
          <div className="phone-claim">
            <p className="phone-hint">Tap your colour and the ranking starts.</p>
            <div className="phone-claim-row">
              {board.players.map((player) => (
                <button type="button" key={player.id} onClick={() => claim(player.id)}>
                  <span className="phone-swatch" style={{ background: player.color }} />
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

  return (
    <section className="panel analysis-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Draft analysis</span>
          <h2>Best picks</h2>
        </div>
      </div>
      <p className="analysis-context">
        You are{' '}
        <MenuSelect
          ariaLabel="Which player is you"
          value={board.mePlayerId}
          options={board.players.map((player) => ({ value: player.id, label: player.name }))}
          onSelect={claim}
        >
          <strong>{me ? me.name : 'choose player'}</strong>
        </MenuSelect>
        {contextTail}
      </p>
      {warnings}
      {body}
    </section>
  )
}
