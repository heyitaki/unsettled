import { useEffect, useState, type ComponentProps } from 'react'
import { movePlayer, removePlayer, renamePlayer, setMe } from '../model/board'
import type { Game } from '../model/game'
import { assignPrint, identify, isDefaultName, joinTarget, nameKey, renamePerson, type Person } from '../model/people'
import type { Board, Player } from '../model/types'
import { loadPeople, savePeople } from '../persistence/localStorage'
import type { ConfirmDialog } from './ConfirmDialog'
import { activeTab, useStore } from './store'
import { useCoarsePointer } from './useMediaQuery'
import { useRowReorder } from './useRowReorder'

type RenameDecision = 'join' | 'all' | 'photo'
interface RenameChoice {
  kind: 'join' | 'rename'
  game: Game
  tabId: string
  id: string
  name: string
  person: Person
}

export function useRoster(game: Game, commit: (board: Board) => void) {
  const { board } = game
  const { state, dispatch } = useStore()
  const tabId = activeTab(state).id
  const coarse = useCoarsePointer()
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const [pending, setPending] = useState<RenameChoice | null>(null)
  useEffect(() => setPending(null), [game, tabId])
  const reorder = useRowReorder({
    coarse,
    ids: board.players.map((player) => player.id),
    rowSelector: '.roster-row',
    trashSelector: '.roster-trash',
    lockedId: editing?.id,
    onMove: (id, index) => commit(movePlayer(board, id, index)),
    onRemove: (id) => commit(removePlayer(board, id)),
  })
  const rename = (id: string, next: string, decision?: RenameDecision) => {

    // Rename commits on blur, so leaving the field unchanged must not save an identity.
    if (!decision && board.players.find((player) => player.id === id)?.name === next) return
    const duplicate = board.players.find((player) => player.id !== id && nameKey(player.name) === nameKey(next))
    if (duplicate) {
      dispatch({ type: 'notice', message: `${duplicate.name} is already in this game. Choose a different name.` })
      return
    }
    const print = game.avatars?.[id]

    // Default seat names never become identities.
    if (typeof print === 'string' && !isDefaultName(next)) {
      const people = loadPeople()
      const target = joinTarget(people, print, next)
      if (target !== null && decision !== 'join') {
        setPending({ kind: 'join', game, tabId, id, name: target.name, person: target })
        return
      }
      const current = identify(people, print)
      if (!decision && current && current.prints.length > 1 && !people.some((person) => nameKey(person.name) === nameKey(next))) {
        setPending({ kind: 'rename', game, tabId, id, name: next, person: current })
        return
      }
      const assigned = decision === 'all' && current
        ? renamePerson(people, current.name, next)
        : assignPrint(people, print, next)
      const saved = savePeople(assigned)
      if (!saved.ok) {
        dispatch({ type: 'notice', message: `Could not save the player identity: ${saved.error}` })
        return
      }
      next = assigned.find((person) => nameKey(person.name) === nameKey(next))!.name
    }
    commit(renamePlayer(board, id, next))
  }
  const commitRename = () => {
    if (!editing) return
    const next = editing.draft.trim()
    setEditing(null)
    if (next) rename(editing.id, next)
  }
  const cancelChoice = () => setPending(null)
  const choose = (decision: RenameDecision) => {
    if (!pending) return
    cancelChoice()
    rename(pending.id, pending.name, decision)
  }
  const confirm: ComponentProps<typeof ConfirmDialog> | null = pending?.game === game && pending.tabId === tabId ? {
    title: pending.kind === 'join' ? `Join with ${pending.name}?` : `Rename ${pending.person.name}?`,
    message: pending.kind === 'rename' ? `${pending.person.name} has ${pending.person.prints.length} photos.` : undefined,
    actions: pending.kind === 'join' ? [
      { label: 'Join', variant: 'primary', onClick: () => choose('join') },
      { label: 'Cancel', onClick: cancelChoice },
    ] : [
      { label: 'Rename everywhere', variant: 'primary', onClick: () => choose('all') },
      { label: 'Only this photo', onClick: () => choose('photo') },
      { label: 'Cancel', onClick: cancelChoice },
    ],
    onCancel: cancelChoice,
  } : null
  const renameProps = (player: Player) => ({
    name: player.name,
    draft: editing?.id === player.id ? editing.draft : null,
    onDraft: (draft: string) => setEditing({ id: player.id, draft }),
    onStart: () => setEditing({ id: player.id, draft: player.name }),
    onCommit: commitRename,
    onCancel: () => setEditing(null),
  })
  return {
    confirm,
    reorder,
    renameProps,
    mePlayerId: board.mePlayerId,
    claim: (id: string) => commit(setMe(board, id)),
  }
}
