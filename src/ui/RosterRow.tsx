import type { ReactNode } from 'react'
import type { Player } from '../model/types'
import { GripGlyph, TrashGlyph } from './glyphs'
import { InlineRename } from './InlineRename'
import type { useRoster } from './useRoster'

type Roster = ReturnType<typeof useRoster>

export function RosterRow({ player, index, roster, swatch, awards, children }: {
  player: Player
  index: number
  roster: Roster
  swatch?: ReactNode
  awards?: ReactNode
  children: ReactNode
}) {
  const { reorder } = roster
  const me = roster.mePlayerId === player.id
  const lifted = reorder.dragId === player.id
  const offset = reorder.offsetFor(index)
  const classes = ['roster-row']
  if (me) classes.push('me')
  if (lifted) classes.push('dragging')
  else if (reorder.dragId !== null
    && reorder.dropTarget?.kind === 'row' && reorder.dropTarget.index === index) {
    classes.push('drag-over')
  }
  return (
    <div
      className={classes.join(' ')}
      style={offset !== 0 ? { transform: `translateY(${offset}px)` } : undefined}
      {...reorder.rowProps(player.id)}
    >

      {/* S8: the row-wide claim button is keyboard reachable and announces the
          claimed seat; the row's other controls paint over it. */}
      <button
        type="button"
        className="list-row-select"
        aria-label={`Claim ${player.name}`}
        aria-pressed={me}
        onClick={() => roster.claim(player.id)}
      />
      <span
        className="roster-grip"
        aria-hidden="true"
        onPointerDown={(event) => reorder.startImmediately(event, player.id)}
      >
        <GripGlyph />
      </span>

      {/* DB3: the desktop swatch toggles whose pieces the brush places without
          changing the claim; deselecting it lets board clicks place nothing. */}
      {swatch ?? <span className="swatch" style={{ background: player.color }} />}
      <span className="list-row-main">
        <InlineRename {...roster.renameProps(player)} />
        {awards}
      </span>
      <span className={me ? 'you-chip' : 'you-chip none'}>You</span>
      {children}
    </div>
  )
}

export function RosterTrash({ roster, playerCount }: { roster: Roster; playerCount: number }) {
  const { dragId, dropTarget } = roster.reorder
  if (dragId === null || playerCount <= 1) return null
  return (
    <div className={dropTarget?.kind === 'trash' ? 'roster-trash over' : 'roster-trash'}>
      <TrashGlyph />
      Drop here to remove
    </div>
  )
}
