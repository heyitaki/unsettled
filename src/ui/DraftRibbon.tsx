import { inferDraftState } from '../engine/draft'
import { setMe } from '../model/board'
import { readableInk } from './colors'
import { draftSlots } from './draftSlots'
import { activeTab, useStore } from './store'

/**
 * The snake draft as a row (spec S2, D4): one circle per pick, tinted to the
 * player who takes it. Taken picks are solid, later ones faded, the current
 * one ringed, and each of the claimed player's own picks carries a dot beneath
 * it. Clicking a circle claims its player.
 */
export function DraftRibbon() {
  const { state, dispatch } = useStore()
  const { board } = activeTab(state).game
  const slots = draftSlots(board, inferDraftState(board))
  return (
    <div className="draft-ribbon" aria-label="Snake draft order">
      {slots.map((slot, index) => {
        const player = board.players.find((candidate) => candidate.id === slot.playerId)
        if (!player) return null
        const label = `Pick ${index + 1}: ${player.name}`
        const classes = ['draft-ribbon-slot']
        if (!slot.placed && !slot.current) classes.push('pending')
        if (slot.current) classes.push('now')
        if (slot.mine) classes.push('mine')
        return (
          <button
            type="button"
            key={`${slot.playerId}:${index}`}
            className={classes.join(' ')}
            style={{ background: player.color, color: readableInk(player.color) }}
            title={label}
            aria-label={label}
            aria-pressed={slot.mine}
            onClick={() => {
              if (!slot.mine) dispatch({ type: 'commit', board: setMe(board, slot.playerId) })
            }}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )
}
