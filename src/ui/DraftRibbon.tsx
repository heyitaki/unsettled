import { useEffect, useRef, useState } from 'react'
import { useAnalysis } from './useAnalysis'
import { readableInk } from './colors'
import { draftSlots } from './draftSlots'
import { activeTab, useStore, type HighlightMark } from './store'

/**
 * The snake draft as a row (spec S2, D4): one circle per pick, tinted to the
 * player who takes it. Taken picks are solid, later ones faded, the current
 * one ringed, and each of the claimed player's own picks carries a dot beneath
 * it. A click marks the pick's settlement, or where the analysis expects it, on
 * the board.
 */
export function DraftRibbon() {
  const { state, dispatch } = useStore()
  const { board } = activeTab(state).game
  const { analysis } = useAnalysis()
  const slots = draftSlots(board, analysis)
  const [selected, setSelected] = useState<number | null>(null)
  // An edit moves or invalidates the marked pick, so the selection drops with it.
  useEffect(() => {
    setSelected(null)
  }, [board])
  // The marks this ribbon last put on the board. Anything else writing the
  // highlight (a card tapped in the analysis block) takes the outline with it.
  const own = useRef<readonly HighlightMark[] | null>(null)
  useEffect(() => {
    if (state.highlight !== own.current) setSelected(null)
  }, [state.highlight])
  return (
    <div className="draft-ribbon" aria-label="Snake draft order">
      {slots.map((slot, index) => {
        const player = board.players.find((candidate) => candidate.id === slot.playerId)
        if (!player) return null
        const classes = ['draft-ribbon-slot']
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
              own.current = next !== null && slot.vertex
                ? [{ ref: slot.vertex, color: player.color, label: String(index + 1) }]
                : null
              dispatch({ type: 'highlight', marks: own.current })
            }}
          >
            {index + 1}
          </button>
        )
      })}
    </div>
  )
}
