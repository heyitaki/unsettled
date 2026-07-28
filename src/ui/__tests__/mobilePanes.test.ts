import { describe, expect, it } from 'vitest'
import { PANES, type PaneId } from '../mobilePanes'

// Adding a PaneId makes this map a type error until the new pane is listed here
// as well, so the coverage check below cannot quietly stop covering the union.
const EVERY_PANE: Record<PaneId, true> = { board: true, players: true, picks: true, library: true }

describe('PANES', () => {
  it('covers every pane id exactly once, so no panel is unreachable on mobile', () => {
    const ids = PANES.map((pane) => pane.id)
    expect([...ids].sort()).toEqual(Object.keys(EVERY_PANE).sort())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is ordered the way the bottom nav reads', () => {
    expect(PANES.map((pane) => pane.id)).toEqual(['board', 'players', 'picks', 'library'])
  })

  it('labels every destination', () => {
    for (const pane of PANES) expect(pane.label.length).toBeGreaterThan(0)
  })
})
