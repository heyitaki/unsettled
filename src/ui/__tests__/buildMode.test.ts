import { describe, expect, it } from 'vitest'
import { createBoard, setLayout } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { newGame, withBoard } from '../../model/game'
import { buildSessionEnded, cancelTarget, openBuildSession } from '../phone/buildMode'
import type { TabState } from '../store'

const tab = (id: string, game = newGame(createBoard('standard4'))): TabState => ({
  id,
  title: id,
  game,
  past: [],
  future: [],
  activePlayerId: null,
  mapId: null,
})

const edited = (from: TabState): TabState => ({
  ...from,
  game: withBoard(from.game, setTile(from.game.board, { q: 0, r: 0 }, 'ore')),
})

describe('buildSessionEnded', () => {
  it('holds through edits on the tab it opened on', () => {
    const opened = tab('a')
    const session = openBuildSession(opened)
    expect(buildSessionEnded(session, opened)).toBe(false)
    expect(buildSessionEnded(session, edited(opened))).toBe(false)
  })

  it('ends when another tab is shown, as a switch or an import does', () => {
    const session = openBuildSession(tab('a'))
    expect(buildSessionEnded(session, tab('b'))).toBe(true)
  })

  it('ends when the layout is switched under the tools', () => {
    const opened = tab('a')
    const session = openBuildSession(opened)
    const switched = { ...opened, game: withBoard(opened.game, setLayout(opened.game.board, 'extension6')) }
    expect(buildSessionEnded(session, switched)).toBe(true)
  })
})

describe('cancelTarget', () => {
  it('owes nothing when the game is the one it entered on', () => {
    const opened = tab('a')
    expect(cancelTarget(openBuildSession(opened), opened)).toBeNull()
  })

  it('restores the entry game once the board has changed', () => {
    const opened = tab('a')
    expect(cancelTarget(openBuildSession(opened), edited(opened))).toBe(opened.game)
  })
})
