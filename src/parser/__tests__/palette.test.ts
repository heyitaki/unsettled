import { describe, expect, it } from 'vitest'
import { nearest } from '../palette'

describe('nearest palette entry', () => {
  it('includes the tolerance boundary and gives equal-distance ties to the last entry', () => {
    const entries = [['first', [8, 10, 10]], ['last', [12, 10, 10]]] as const
    expect(nearest([10, 10, 10], entries, 2)).toBe('last')
    expect(nearest([10, 10, 10], entries, 1)).toBeNull()
    expect(nearest([8, 10, 10], entries, 2)).toBe('first')
  })
})
