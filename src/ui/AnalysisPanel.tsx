import { useEffect } from 'react'
import { analyzeBoardCached, type Recommendation } from '../engine/analyze'
import { placeBuilding, setMe } from '../model/board'
import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import type { Board, Resource, VertexId } from '../model/types'
import { MenuSelect } from './MenuSelect'
import { activeTab, useStore, type HighlightMark } from './store'

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
const recommendationMarks = (
  recommendation: Recommendation,
  color: string,
): HighlightMark[] => [
  { ref: recommendation.firstPick, color, label: '1' },
  ...recommendation.plannedSecond.slice(0, 1).map((ref) => ({ ref, color, label: '2' })),
]

function formatFactor(value: number): string {
  const magnitude = Math.abs(value).toFixed(1)
  return value < 0 ? `−${magnitude}` : `+${magnitude}`
}

function displayedFactors(recommendation: Recommendation): readonly [string, number][] {
  const factors: [string, number][] = [
    ['Production', recommendation.breakdown.production],
    ['Scarcity', recommendation.breakdown.scarcity],
    ['Diversity+recipes+numbers', recommendation.breakdown.diversity],
    ['Port', recommendation.breakdown.port],
    ['Robber', recommendation.breakdown.robber],
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

export function AnalysisPanel() {
  const { state, dispatch } = useStore()
  const board = activeTab(state).game.board
  const analysis = analyzeBoardCached(board)
  const recommendations = analysis.recommendations.slice(0, 5)

  // Clear any hovered board marks whenever the board changes — after a click
  // places settlements, the previous window's circles are stale.
  useEffect(() => {
    dispatch({ type: 'highlight', marks: null })
    return () => dispatch({ type: 'highlight', marks: null })
  }, [board, dispatch])

  const playerColor = (id: string) =>
    board.players.find((player) => player.id === id)?.color ?? '#8a7a63'
  const clearHighlight = () => dispatch({ type: 'highlight', marks: null })

  const me = board.players.find((player) => player.id === board.mePlayerId)
  const myColor = me?.color ?? '#8a7a63'
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
  }
  const placeRecommendation = (recommendation: Recommendation) => {
    if (board.mePlayerId === null) return
    // Only place on my actual turn. While opponents still pick before me, my
    // settlement would land at the wrong point in the draft — skipping those
    // opponents and tripping the snake-inconsistent path. Guide the user to play
    // the pre-window out first; the row stays hoverable so the 1/2 preview works.
    if (likelyGone.length > 0) {
      dispatch({
        type: 'notice',
        message: 'Play out the picks before your turn first: click "Likely gone before your turn".',
      })
      return
    }
    dispatch({
      type: 'commit',
      board: placeBuilding(board, recommendation.firstPick, board.mePlayerId, 'settlement'),
    })
  }

  const emptyMessage: Partial<Record<typeof analysis.status, string>> = {
    'no-me': 'Pick who you are above to get recommendations.',
    'no-availability': 'No spot is likely to survive until your pick.',
    'no-production': 'Add number tokens to the board to analyze placements.',
    complete: 'The draft is finished. Every starting settlement is placed.',
    'me-done': 'Your starting settlements are placed. Waiting on the rest of the draft.',
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
          onSelect={(playerId) => dispatch({ type: 'commit', board: setMe(board, playerId) })}
        >
          <strong>{me ? me.name : 'choose player'}</strong>
        </MenuSelect>
        {contextTail}
      </p>
      {analysis.warnings.includes('snake-inconsistent') && (
        <p className="analysis-warning">
          Placed settlements don't match a clean snake draft, so recommendations are best-effort.
        </p>
      )}
      {analysis.warnings.includes('solo-roster') && (
        <p className="analysis-warning">Only one player on the board.</p>
      )}

      {analysis.status !== 'ready' ? (
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
          )}
          <div className="analysis-list" onMouseLeave={clearHighlight}>
            {recommendations.map((recommendation, index) => {
              const factors = displayedFactors(recommendation)
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
                  <span className="analysis-rank">{index + 1}</span>
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
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
