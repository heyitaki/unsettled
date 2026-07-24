import { useEffect, useMemo, useState } from 'react'
import { analyzeBoard, type Recommendation } from '../engine/analyze'
import { axialKey, edgeEndpointVertexIds, vertexTouchingHexes } from '../model/coords'
import type { Board, Resource, VertexId } from '../model/types'
import { activeTab, useStore } from './store'

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

const recommendationRefs = (recommendation: Recommendation | undefined): VertexId[] =>
  recommendation
    ? [recommendation.firstPick, ...recommendation.plannedSecond.slice(0, 1)]
    : []

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
  const board = activeTab(state).board
  const analysis = useMemo(() => analyzeBoard(board), [board])
  const [pinnedRank, setPinnedRank] = useState<number | null>(null)
  const recommendations = analysis.recommendations.slice(0, 5)

  useEffect(() => {
    setPinnedRank(null)
    dispatch({ type: 'highlight', ref: null })
    return () => dispatch({ type: 'highlight', ref: null })
  }, [board, dispatch])

  const restorePinned = () => {
    dispatch({
      type: 'highlight',
      ref: pinnedRank === null ? null : recommendationRefs(recommendations[pinnedRank]),
    })
  }
  const highlightRecommendation = (recommendation: Recommendation) => {
    dispatch({ type: 'highlight', ref: recommendationRefs(recommendation) })
  }
  const togglePinned = (rank: number) => {
    const next = pinnedRank === rank ? null : rank
    setPinnedRank(next)
    dispatch({
      type: 'highlight',
      ref: next === null ? null : recommendationRefs(recommendations[next]),
    })
  }

  const me = board.players.find((player) => player.id === board.mePlayerId)
  const pickText = analysis.draft.myPickIndices.map((index) => index + 1).join(' and ')
  const turnText = analysis.draft.turnIndex === null
    ? ''
    : analysis.draft.currentPlayerId === board.mePlayerId
      ? 'your turn'
      : `${board.players.find((player) => player.id === analysis.draft.currentPlayerId)?.name ??
        analysis.draft.currentPlayerId}'s turn`
  const context = me
    ? `You are ${me.name} — picks ${pickText} of ${analysis.draft.sequence.length}${
      analysis.draft.placedCount > 0 && analysis.draft.turnIndex !== null
        ? ` · pick ${analysis.draft.turnIndex + 1} of ${analysis.draft.sequence.length} — ${turnText}`
        : ''
    }`
    : null
  const likelyGone = analysis.takenBeforeFirstPick.slice(0, 4)

  const emptyMessage: Partial<Record<typeof analysis.status, string>> = {
    'no-me': 'Mark which player is you (the You chip in Players) to get recommendations.',
    'no-availability': 'No spot is likely to survive until your pick.',
    'no-production': 'Add number tokens to the board to analyze placements.',
    complete: 'The draft is finished — every starting settlement is placed.',
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
      {context && <p className="analysis-context">{context}</p>}
      {analysis.warnings.includes('snake-inconsistent') && (
        <p className="analysis-warning">
          Placed settlements don't match a clean snake draft — recommendations are best-effort.
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
              onMouseEnter={() => dispatch({
                type: 'highlight',
                ref: likelyGone.map(({ vertexId }) => vertexId),
              })}
              onMouseLeave={restorePinned}
            >
              <span>Likely gone before your turn</span>
              {likelyGone.map(({ vertexId, frequency }) =>
                `${vertexDescription(board, vertexId)} ${Math.round(frequency * 100)}%`).join(' · ')}
            </button>
          )}
          <div className="analysis-list" onMouseLeave={restorePinned}>
            {recommendations.map((recommendation, index) => {
              const factors = displayedFactors(recommendation)
              return (
                <button
                  type="button"
                  key={recommendation.firstPick}
                  className={`analysis-row${pinnedRank === index ? ' pinned' : ''}`}
                  onMouseEnter={() => highlightRecommendation(recommendation)}
                  onClick={() => togglePinned(index)}
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
          <p className="analysis-ranking-note">Ranked by score × availability.</p>
        </>
      )}
    </section>
  )
}
