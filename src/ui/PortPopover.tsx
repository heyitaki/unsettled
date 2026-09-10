import { useState } from 'react'
import type { EdgeId, Port, Resource } from '../model/types'

interface Props {
  edgeId: EdgeId
  port?: Port
  onCancel(): void
  onDelete(): void
  onSave(resource: Resource | null, rate: number): void
}

export function PortPopover({ edgeId, port, onCancel, onDelete, onSave }: Props) {
  const [resource, setResource] = useState<Resource | ''>(port?.resource ?? '')
  const [rate, setRate] = useState(String(port?.rate ?? 3))
  return (
    <div className="popover-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="port-popover"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(resource || null, Number(rate))
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">Coastal trade</span>
        <h3>Edit port</h3>
        <code>{edgeId}</code>
        <label>
          Resource
          <select value={resource} onChange={(event) => setResource(event.target.value as Resource | '')}>
            <option value="">Any resource</option>
            <option value="wood">Wood</option>
            <option value="sheep">Sheep</option>
            <option value="wheat">Wheat</option>
            <option value="brick">Brick</option>
            <option value="ore">Ore</option>
          </select>
        </label>
        <label>
          Rate
          <input inputMode="numeric" type="number" min="2" max="20" step="1" required value={rate} onChange={(event) => setRate(event.target.value)} />
        </label>
        <div className="popover-actions">
          {port && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
          <span />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">Save port</button>
        </div>
      </form>
    </div>
  )
}
