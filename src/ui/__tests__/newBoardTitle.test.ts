// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { saveMap } from '../../persistence/localStorage'
import { newBoardTitle } from '../boardFiles'

describe('newBoardTitle', () => {
  beforeEach(() => localStorage.clear())

  it('skips names held by open boards', () => {
    expect(newBoardTitle([])).toBe('Board 1')
    expect(newBoardTitle([{ title: 'Board 1' }, { title: 'Board 3' }])).toBe('Board 2')
  })

  it('skips the name of a saved map that is not open', () => {
    expect(saveMap('Board 2', newGame(createBoard('standard4'))).ok).toBe(true)
    expect(newBoardTitle([{ title: 'Board 1' }])).toBe('Board 3')
  })
})
