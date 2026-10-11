// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { CARD_COSTS } from '../../model/turn'
import { BestMovesTable, CardAmounts, ResourcePicker } from '../BestMovesTable'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let style: HTMLStyleElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  style = document.createElement('style')
  style.textContent = readFileSync('src/ui/editor.css', 'utf8')
  document.head.append(style)
  container = document.createElement('div')
  container.className = 'best-moves-panel'
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  style.remove()
})

it('keeps Cards and Points equally selected with the hand editor open, without a cross-fade', async () => {
  await act(async () => root.render(<BestMovesTable game={newGame(createBoard('standard4'))} activeId="aki" commit={() => {}} />))
  const [cards, points] = container.querySelectorAll<HTMLButtonElement>('.move-seg button')
  const selectedStyle = (button: HTMLButtonElement) => {
    const computed = getComputedStyle(button)
    return { color: computed.color, background: computed.backgroundColor, opacity: computed.opacity || '1', transition: computed.transition }
  }
  const initial = selectedStyle(cards)
  expect(initial.transition).toBe('none')
  expect(initial.opacity).toBe('1')
  expect(initial.color).toBe('rgb(255, 255, 255)')
  await act(async () => points.click())
  await act(async () => container.querySelector<HTMLButtonElement>('.move-who')!.click())
  expect(container.querySelector('.move-edit')).not.toBeNull()
  expect(points.disabled).toBe(false)
  expect(points.getAttribute('aria-pressed')).toBe('true')
  expect(selectedStyle(points)).toEqual(initial)
  await act(async () => cards.click())
  expect(selectedStyle(cards)).toEqual(initial)
})

it('makes selected build and resource glyphs white while preserving advice glyph colours', async () => {
  await act(async () => root.render(<>
    <button aria-pressed="true">Road <CardAmounts cards={CARD_COSTS.road} /></button>
    <ResourcePicker label="Gives" value="brick" onChange={() => {}} />
    <button className="analysis-row-select" aria-pressed="true"><CardAmounts cards={CARD_COSTS.road} /></button>
  </>))
  const pressed = container.querySelectorAll('button[aria-pressed="true"]:not(.analysis-row-select) .stat-icon')
  expect(pressed).toHaveLength(3)
  for (const glyph of pressed) expect(getComputedStyle(glyph).filter).toBe('brightness(0) invert(1)')
  for (const glyph of container.querySelectorAll('button[aria-pressed="false"] .stat-icon, .analysis-row-select .stat-icon')) expect(getComputedStyle(glyph).filter).toBe('none')
})
