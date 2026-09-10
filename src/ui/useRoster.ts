import { useState } from 'react'
import { movePlayer, removePlayer, renamePlayer, setMe } from '../model/board'
import type { Board, Player } from '../model/types'
import { useCoarsePointer } from './useMediaQuery'
import { useRowReorder } from './useRowReorder'

export function useRoster(board: Board, commit: (board: Board) => void) {
  const coarse = useCoarsePointer()
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const reorder = useRowReorder({
    coarse,
    ids: board.players.map((player) => player.id),
    rowSelector: '.roster-row',
    trashSelector: '.roster-trash',
    lockedId: editing?.id,
    onMove: (id, index) => commit(movePlayer(board, id, index)),
    onRemove: (id) => commit(removePlayer(board, id)),
  })
  const commitRename = () => {
    if (!editing) return
    const next = editing.draft.trim()
    setEditing(null)
    if (next) commit(renamePlayer(board, editing.id, next))
  }
  const renameProps = (player: Player) => ({
    name: player.name,
    draft: editing?.id === player.id ? editing.draft : null,
    onDraft: (draft: string) => setEditing({ id: player.id, draft }),
    onStart: () => setEditing({ id: player.id, draft: player.name }),
    onCommit: commitRename,
    onCancel: () => setEditing(null),
  })
  return {
    reorder,
    renameProps,
    mePlayerId: board.mePlayerId,
    claim: (id: string) => commit(setMe(board, id)),
  }
}
