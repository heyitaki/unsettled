import { useEffect, useState } from 'react'
import { analyzeBoardCached } from '../../engine/analyze'
import { readableInk } from '../colors'
import { draftSlots } from '../draftSlots'
import { activeTab, useStore } from '../store'

/**
 * The snake draft above the board (spec S2): one circle per pick, tinted to the
 * player who takes it. Taken picks are solid, later ones faded, the current one
 * ringed, and each of the claimed player's own picks carries a dot beneath it.
 * A tap marks the pick's settlement, or where the analysis expects it, on the
 * board, the way the desktop draft strip does on a coarse pointer.
 */
export function PhoneRibbon() {
  const { state, dispatch } = useStore()
  const { board } = activeTab(state).game
  const slots = draftSlots(board, analyzeBoardCached(board))
  const [selected, setSelected] = useState<number | null>(null)
  // An edit moves or invalidates the marked pick, so the selection drops with it.
  useEffect(() => {
    setSelected(null)
  }, [board])
  return (
    <div className="phone-ribbon" aria-label="Snake draft order">
      {slots.map((slot, index) => {
        const player = board.players.find((candidate) => candidate.id === slot.playerId)
        if (!player) return null
        const classes = ['phone-rslot']
        if (!slot.placed && !slot.current) classes.push('pending')
        if (slot.current) classes.push('now')
        if (slot.mine) classes.push('mine')
        if (selected === index) classes.push('selected')
        const standing = slot.placed ? '' : slot.vertex ? ' (predicted spot)' : ' (not placed yet)'
        return (
          <button
            type="button"
            key={`${slot.playerId}:${index}`}
            className={classes.join(' ')}
            style={{ background: player.color, color: readableInk(player.color) }}
            title={`Pick ${index + 1}: ${player.name}${standing}`}
            onClick={() => {
              const next = selected === index ? null : index
              setSelected(next)
              dispatch({
                type: 'highlight',
                marks: next !== null && slot.vertex
                  ? [{ ref: slot.vertex, color: player.color, label: String(index + 1) }]
                  : null,
              })
            }}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )
}
