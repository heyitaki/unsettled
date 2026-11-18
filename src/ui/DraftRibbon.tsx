import type { CSSProperties } from 'react'
import { inferDraftState } from '../engine/draft'
import { readableInk } from './colors'
import { draftSlots, viewedPlayerId, viewPick } from './draftSlots'
import { activeTab, useStore } from './store'

/**
 * The snake draft as a row (spec S2, D4): one circle per pick, tinted to the
 * player who takes it. Taken picks and the current one are solid, later ones
 * faded. The ring marks the viewed pick, independently of the claim.
 */
export function DraftRibbon() {
  const { state, dispatch } = useStore()
  const { board } = activeTab(state).game
  const draft = inferDraftState(board)
  const slots = draftSlots(board, draft, state.viewedPick)
  const playerId = viewedPlayerId(board, state.viewedPick)
  return (
    <div className="draft-ribbon" aria-label="Snake draft order" style={{ '--slots': slots.length } as CSSProperties}>
      {slots.map((slot, index) => {
        const player = board.players.find((candidate) => candidate.id === slot.playerId)
        if (!player) return null
        const label = `Pick ${index + 1}: ${player.name}`
        // Fade the fill, the numeral and the border rather than the button, so the
        // ring on a pick still to come stays at full strength.
        const tone = (color: string) =>
          slot.placed || slot.current ? color : `color-mix(in srgb, ${color} 34%, var(--surface))`
        return (
          <button
            type="button"
            key={`${slot.playerId}:${index}`}
            className={slot.viewed ? 'draft-ribbon-slot viewing' : 'draft-ribbon-slot'}
            style={{ background: tone(player.color), color: tone(readableInk(player.color)), borderColor: slot.viewed ? 'var(--ink)' : tone('color-mix(in srgb, var(--ink) 55%, transparent)') }}
            title={label}
            aria-label={label}
            aria-pressed={slot.playerId === playerId}
            onClick={() => {
              const pick = draft.remainingPickIndices.includes(index)
                ? index
                : draft.remainingPickIndices.find((pick) => draft.sequence[pick] === slot.playerId)
              if (pick !== undefined) viewPick(board, dispatch, pick)
            }}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )
}
