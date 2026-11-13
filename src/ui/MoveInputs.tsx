import type { ReactNode } from 'react'
import { RESOURCES, type Resource } from '../model/types'
import { ResourceGlyph } from './glyphs'

export function MoveStepper({ label, value, onChange, max = Infinity, children }: {
  label: string
  value: number
  onChange(value: number): void
  max?: number
  children?: ReactNode
}) {
  return (
    <span className="move-chip">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span>{children ?? label} {value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}

export function ResourcePicker({ label, value, cards, onChange }: {
  label?: string
  value?: Resource | null
  cards?: Partial<Record<Resource, number>>
  onChange(value: Resource): void
}) {
  return (
    <div className="move-res-row" role="group" aria-label={label}>
      {RESOURCES.map((resource) => (
        <button
          type="button"
          key={resource}
          title={resource}
          aria-label={label ? `${label} ${resource}` : resource}
          aria-pressed={value === undefined ? undefined : value === resource}
          onClick={() => onChange(resource)}
        >
          <ResourceGlyph resource={resource} />
          {!!cards?.[resource] && <span className="count">{cards[resource]}</span>}
        </button>
      ))}
    </div>
  )
}

export function CardAmounts({ cards, signed = false }: { cards: Partial<Record<Resource, number>>; signed?: boolean }) {
  return (
    <>
      {RESOURCES.flatMap((resource) => {
        const count = cards[resource] ?? 0
        const amount = `${count < 0 ? '−' : signed ? '+' : ''}${Math.abs(count)}`
        return count === 0 ? [] : [
          <span
            className="hex-label"
            key={resource}
            role="img"
            aria-label={`${amount} ${resource}`}
            title={`${amount} ${resource}`}
          >
            <ResourceGlyph resource={resource} />
            {amount}
          </span>,
        ]
      })}
    </>
  )
}
