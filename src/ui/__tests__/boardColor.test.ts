import { describe, expect, it } from 'vitest'
import { BOARD_PALETTE, boardColor } from '../boardColor'

describe('boardColor', () => {
  it('gives the same name the same colour', () => {
    expect(boardColor('Island hop')).toBe(boardColor('Island hop'))
  })

  it('has ten distinct palette entries', () => {
    expect(BOARD_PALETTE).toHaveLength(10)
    expect(new Set(BOARD_PALETTE).size).toBe(10)
  })

  it('maps an empty name to the first palette entry', () => {
    expect(boardColor('')).toBe(BOARD_PALETTE[0])
  })

  it('gives names that hash to different indices different colours', () => {
    // "Board 1" hashes to index 5 and "Board 2" to index 6 under the prototype's hash.
    expect(boardColor('Board 1')).toBe(BOARD_PALETTE[5])
    expect(boardColor('Board 2')).toBe(BOARD_PALETTE[6])
    expect(boardColor('Board 1')).not.toBe(boardColor('Board 2'))
  })
})
