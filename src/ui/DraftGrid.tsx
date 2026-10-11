import type { CSSProperties } from 'react'
import { inferDraftState, type DraftState } from '../engine/draft'
import type { Board } from '../model/types'
import { readableInk } from './colors'
import { draftSlots } from './draftSlots'

function DraftLabel({ draft }: { draft: DraftState }) {
  const { turnIndex, sequence } = draft
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
 * current one outlined and the rest dashed. Player claiming stays in the
 * roster and the analysis ribbon.
 */
export function DraftGrid({ board }: { board: Board }) {
  const draft = inferDraftState(board)
  const slots = draftSlots(board, draft)
  return (
    <div className="draft-section">
      <DraftLabel draft={draft} />
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
