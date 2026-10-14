import type { Building, Player } from '../../../model/types'
import { labelComponents } from '../../components'
import { pixel, type Rgb, type RgbaImage } from '../../image'
import { snakeOrder } from '../../pieces'
import type { ParseIssue } from '../types'
import { readCounter } from './counters'
import { isSea, seatPlayer, type Seat } from './palette'
import type { ColonistRegistration } from './registration'

export interface PanelPlayer {
  player: Player
  hand: number | null
  vp: number | null
  devCards: number | null
  knights: number | null
}

export function readPanel(image: RgbaImage, registration: ColonistRegistration, buildings: Building[]): {
  players: PanelPlayer[]
  mePlayerId: string
  // Whether the first player was worked out, so the list is in turn order.
  ordered: boolean
  issues: ParseIssue[]
} | null {
  const size = registration.size
  const rings = [...labelComponents({
    minX: Math.round(registration.center({ q: 2, r: 0 })[0] + size),
    maxX: image.width - 1,
    minY: 0,
    maxY: image.height - 1,
  }, (x, y) => {
    const index = (y * image.width + x) * 4
    return avatarColor([image.data[index], image.data[index + 1], image.data[index + 2]])
  })]
    .filter((component) => {
      const width = component.maxX - component.minX + 1
      const height = component.maxY - component.minY + 1
      return width > 0.3 * size && width < 1.5 * size && height / width > 0.65 && height / width < 1.1 &&
        component.area > 0.3 * width * height
    }).map((component) => ({
      seat: component.label,
      x: (component.minX + component.maxX) / 2,
      y: component.minY,
      width: component.maxX - component.minX + 1,
    }))
  const groups = rings.map((first) => rings.filter((ring) => Math.abs(ring.x - first.x) < 0.1 * first.width)
    .sort((a, b) => a.y - b.y))
  const rows = groups.find((group) => {
    if (group.length < 3 || group.length > 4 || new Set(group.map((ring) => ring.seat)).size !== group.length) return false
    const rivals = group.slice(0, -1)
    const viewer = group[group.length - 1]
    return rivals.every((ring) => Math.abs(ring.width / rivals[0].width - 1) < 0.1) &&
      viewer.width / rivals[0].width > 1.6 && viewer.width / rivals[0].width < 2 &&
      rivals.slice(1).every((ring, index) => {
        const gap = (ring.y - rivals[index].y) / rivals[0].width
        return gap > 2 && gap < 5.3
      })
  })
  if (!rows) return null
  const gaps = rows.slice(1, -1).map((row, index) => row.y - rows[index].y)

  // Row spacing measures the UI scale even when one avatar is hidden.
  const steps = gaps.map((gap) => Math.round(gap / (2.45 * rows[0].width)))
  const issues: ParseIssue[] = []
  if (steps.includes(2) || rows.length < 4) issues.push({
    stage: 'roster',
    severity: 'unreadable',
    message: 'A player row is missing or unreadable',
  })
  const diameter = gaps.reduce((sum, gap) => sum + gap, 0) / steps.reduce((sum, step) => sum + step, 0) / 2.28
  const players: PanelPlayer[] = []
  const lit: string[] = []
  for (const [index, row] of rows.entries()) {
    const seat = row.seat
    const player = seatPlayer(seat)
    const viewer = index === rows.length - 1
    const top = row.y - (viewer ? 0.06 : 0.035) * diameter
    const counter = (x: number, y: number, white: boolean) => readCounter(image,
      row.x + x * diameter, top + y * diameter, diameter, white)
    players.push({
      player,
      hand: counter(2.28, viewer ? 0.76 : -0.1, true),
      devCards: counter(3.63, viewer ? 0.76 : -0.1, true),
      knights: counter(4.9, viewer ? 1.8 : 0.88, false),
      vp: counter(0, viewer ? 1.85 : 1.05, false),
    })
    let bright = 0
    for (const dx of [1.2, 1.3, 1.4]) {
      for (const dy of [0.05, 0.1, 0.15]) {
        if (Math.min(...pixel(image, row.x + dx * diameter, row.y + dy * diameter)) > 210) bright += 1
      }
    }
    if (bright >= 5) lit.push(player.id)
  }
  const mePlayerId = players[players.length - 1].player.id
  const counts = players.map((entry) => buildings.filter((building) => building.playerId === entry.player.id).length)
  const draft = buildings.every((building) => building.tier === 'settlement') &&
    counts.every((count, index) => count <= 2 && players[index].vp === count) && issues.length === 0
  const rotations = draft && buildings.length < 2 * players.length && lit.length === 1
    ? players.map((_, start) => start).filter((start) => {
      const order = [...players.slice(start), ...players.slice(0, start)]
      const picks = snakeOrder(order.map((entry) => [entry, entry])).slice(0, buildings.length)
      if (!players.every((entry, index) => picks.filter((pick) => pick === entry).length === counts[index])) return false
      if (counts.every((count) => count === 0)) return order[0].player.id === lit[0]
      if (counts.every((count) => count === 1)) return order[order.length - 1].player.id === lit[0]
      return true
    }) : []
  if (rotations.length === 1) {
    const start = rotations[0]
    return { players: [...players.slice(start), ...players.slice(0, start)], mePlayerId, ordered: true, issues }
  }
  issues.push({
    stage: 'roster',
    severity: 'warning',
    message: 'The first player could not be told; players are listed in panel order',
  })
  return { players, mePlayerId, ordered: false, issues }
}

function avatarColor([r, g, b]: Rgb): Seat | null {
  if (r > 120 && g < 0.48 * r && b < 0.5 * r) return 'red'
  if (r > 150 && g > 0.48 * r && g < 0.77 * r && b < 0.5 * r) return 'orange'
  if (b > 120 && b > 1.4 * r && b > 1.2 * g && !isSea([r, g, b])) return 'blue'
  if (g > 100 && g > 1.5 * r && g > 1.8 * b) return 'green'
  return null
}
