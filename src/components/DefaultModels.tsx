/**
 * DefaultModels — Settings > Services: for each enabled service the model it uses when a brain names none.
 * The picker is fed by the catalogue (a plain text field when the service lists nothing); "Auto" clears the
 * choice. A model the catalogue does not list is kept but flagged, since catalogues can be stale.
 */

import { useState } from 'react'
import ModelCombo from './ModelCombo'

export interface DefaultModelService {
  name: string
  label: string
  available: boolean
  enabled: boolean
  defaultModel?: string
  adapterDefaultModel?: string
}

interface Props {
  services: DefaultModelService[]
  models: { service: string; id: string; label: string; note?: string }[]
  readOnly: boolean
  /** Save one service's default ('' clears it); resolves to an error text, or null when saved */
  onSave: (service: string, model: string) => Promise<string | null>
}

export default function DefaultModels({ services, models, readOnly, onSave }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, 'saved' | string>>({})
  const rows = services.filter(s => s.available && s.enabled)
  if (!rows.length) return null

  const save = async (s: DefaultModelService, value: string) => {
    const next = value.trim()
    if (next === (s.defaultModel ?? '')) return
    const error = await onSave(s.name, next)
    setStatus(st => ({ ...st, [s.name]: error ?? 'saved' }))
    setDrafts(d => { const { [s.name]: _gone, ...rest } = d; return rest })
  }

  return (
    <div className="default-models" role="group" aria-label="Default model per service">
      {rows.map(s => {
        const options = models.filter(m => m.service === s.name).map(m => ({ id: m.id, label: m.label, note: m.note }))
        const value = drafts[s.name] ?? s.defaultModel ?? ''
        const unlisted = !!value && options.length > 0 && !options.some(o => o.id === value)
        const effective = s.defaultModel || s.adapterDefaultModel || "the CLI's own default"
        const state = status[s.name]
        return (
          <div className="default-model-row" key={s.name}>
            <label className="default-model-label" htmlFor={`default-model-${s.name}`}>Default model · {s.label}</label>
            <div className="default-model-field">
              <ModelCombo
                id={`default-model-${s.name}`}
                value={value}
                options={options}
                placeholder="Auto (service decides)"
                disabled={readOnly}
                onChange={v => setDrafts(d => ({ ...d, [s.name]: v }))}
                onCommit={v => void save(s, v)}
              />
              <button type="button" className="backend-secondary" disabled={readOnly || !(s.defaultModel || value)} onClick={() => void save(s, '')}>Auto</button>
              {state === 'saved' && <span className="default-model-ok" role="status">Saved</span>}
              {state && state !== 'saved' && <span className="backend-error" role="alert">{state}</span>}
            </div>
            {unlisted && <p className="backend-note">This model is not in the service&apos;s list (unlisted); it is used as typed.</p>}
            <p className="backend-note">Used when a brain does not name a model: {effective}</p>
          </div>
        )
      })}
    </div>
  )
}
