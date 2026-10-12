import { readFileSync } from 'node:fs'
import { createBoard, draftOrder, placeBuilding } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import type { Board } from '../../model/types'
import { buildingSlots } from '../placementSlots'

export function finishedDraft(meIndex = 0): Game {
  const fixture: Board = JSON.parse(readFileSync('src/parser/__tests__/expected/board-draft-empty.json', 'utf8'))
  const base = createBoard('standard4')
  let board: Board = { ...base, players: fixture.players.slice(0, 4), mePlayerId: fixture.players[meIndex].id,
    hexes: base.hexes.map((hex) => fixture.hexes.find(({ coord }) => coord.q === hex.coord.q && coord.r === hex.coord.r)!),
    robber: base.hexes[0].coord }
  for (const playerId of draftOrder(board)) {
    board = placeBuilding(board, buildingSlots(board, playerId, 'settlement', 'edit')[0], playerId, 'settlement')
  }
  return newGame(board)
}
