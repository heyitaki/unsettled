import type { ReactNode } from 'react'
import { RESOURCES, type Resource } from '../model/types'
import { MinusGlyph, ResourceGlyph } from './glyphs'

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

export function ResourcePicker({ label, value, cards, available, disabled, onChange, onRemove, resources = RESOURCES }: {
  label?: string
  value?: Resource | null
  cards?: Partial<Record<Resource, number>>
  available?: Record<Resource, number>
  disabled?(resource: Resource): boolean
  onChange(value: Resource): void
  onRemove?(value: Resource): void
  /** The types to offer, in this order; every type by default. */
  resources?: readonly Resource[]
}) {
  return (
    <div className="move-res-row" role="group" aria-label={label}>
      {resources.map((resource) => {
        const count = cards?.[resource] ?? 0
        return <div className="move-res-cell" key={resource}>
          <button
            type="button"
            className="move-resource"
            title={resource}
            aria-label={label ? `${label} ${resource}` : resource}
            aria-pressed={value === undefined ? cards === undefined ? undefined : count > 0 : value === resource}
            disabled={disabled?.(resource)}
            onClick={() => onChange(resource)}
          >
            <ResourceGlyph resource={resource} />
            {cards && <span className={`move-count${count === 0 ? ' zero' : ''}`}>{count}{available && <span>/{available[resource]}</span>}</span>}
          </button>
          {onRemove && count > 0 && <button type="button" className="move-minus" aria-label={`One fewer ${resource}`} onClick={() => onRemove(resource)}><MinusGlyph /></button>}
        </div>
      })}
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
