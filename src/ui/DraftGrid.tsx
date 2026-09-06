import type { CSSProperties } from 'react'
import { inferDraftState } from '../engine/draft'
import type { DraftAnalysis } from '../engine/analyze'
import type { Board } from '../model/types'
import { readableInk } from './colors'
import { draftSlots } from './draftSlots'

export function DraftLabel({ analysis }: { analysis: Pick<DraftAnalysis, 'draft'> }) {
  const { turnIndex, sequence } = analysis.draft
  return (
    <div className="group-label">
      <span>Snake draft</span>
      <span>{turnIndex === null ? 'draft complete' : `pick ${turnIndex + 1} of ${sequence.length}`}</span>
    </div>
  )
}

/**
 * The snake draft on the phone's Players screen (spec S8): one column per
 * player, so the two rounds read as two rows, with the taken picks solid, the
 * current one outlined and the rest dashed. Static on purpose: marking a pick
 * on the board is the ribbon's job.
 */
export function DraftGrid({ board }: { board: Board }) {
  const analysis: DraftAnalysis = {
    draft: inferDraftState(board), status: 'no-production', recommendations: [], takenBeforeFirstPick: [], warnings: [],
  }
  const slots = draftSlots(board, analysis)
  return (
    <div className="draft-section">
      <DraftLabel analysis={analysis} />
      <div className="draft-grid" style={{ '--draft-cols': board.players.length } as CSSProperties}>
        {slots.map((slot, index) => {
          const player = board.players.find((candidate) => candidate.id === slot.playerId)
          if (!player) return null
          const classes = ['draft-grid-slot']
          if (!slot.placed && !slot.current) classes.push('pending')
          if (slot.current) classes.push('now')
          return (
            <div key={`${slot.playerId}:${index}`} className={classes.join(' ')}>
              <span
                className="draft-grid-circle"
                style={{ background: player.color, color: readableInk(player.color) }}
              >
                {index + 1}
              </span>
              <span className="draft-grid-name">{player.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
