/**
 * BrainsPanel — the Brains tab of Settings. A brain is what an agent thinks with: a chain of steps (service,
 * model, reasoning), the first one used and the next one taking over when it is used up (5-hour or weekly
 * window, no credits) or unavailable. An auto brain is a tier and a reasoning level and its steps are
 * recommended from every installed service, so a model that appears later is picked up by itself; a custom
 * brain keeps the steps you chose. Steps that are out for now show why and when they are back.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { officeHttpBase } from '../serverUrl'
import { TIER_LABEL, blockedText, untilText, type Brain, type BrainStep, type BrainsOverview, type CatalogueModel, type Tier } from '../brains'
import ModelCombo from './ModelCombo'
import ThemedSelect from './ThemedSelect'
import { OUTDATED_NOTE } from './BrainChain'

interface Service { name: string; label: string; available: boolean }

interface Props {
  overview: BrainsOverview
  services: Service[]
  models: CatalogueModel[]
  readOnly: boolean
  selectedId: string
  onSelect: (id: string) => void
  onSave: (brain: { id?: string; name: string; auto: boolean; tier?: Tier; effort?: string; steps?: BrainStep[] }) => Promise<boolean>
  onDelete: (id: string) => void
  onClearCooldown: (key?: string) => void
  onRefresh: () => void
}

const NEW = '__new__'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export default function BrainsPanel({ overview, services, models, readOnly, selectedId, onSelect, onSave, onDelete, onClearCooldown, onRefresh }: Props) {
  const brain = overview.brains.find(b => b.id === selectedId)
  const creating = selectedId === NEW

  const [name, setName] = useState('')
  const [auto, setAuto] = useState(true)
  const [tier, setTier] = useState<Tier>('balanced')
  const [effort, setEffort] = useState('medium')
  const [steps, setSteps] = useState<BrainStep[]>([])
  const [dirty, setDirty] = useState(false)

  // The draft follows the brain shown, until it is edited
  useEffect(() => {
    if (dirty) return
    if (creating) { setName(''); setAuto(true); setTier('balanced'); setEffort('medium'); setSteps([]); return }
    if (!brain) return
    setName(brain.name)
    setAuto(!!brain.auto)
    setTier(brain.tier ?? 'balanced')
    setEffort(brain.effort ?? 'medium')
    setSteps(brain.steps.map(s => ({ service: s.service, model: s.model, effort: s.effort, label: s.label, why: s.why, blocked: s.blocked })))
  }, [brain, creating, dirty])
  useEffect(() => { setDirty(false) }, [selectedId])

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true) }
  const label = (service: string) => services.find(s => s.name === service)?.label ?? service
  const modelsOf = useMemo(() => (service: string) => models.filter(m => m.service === service), [models])
  const effortsFor = (s: BrainStep) => {
    const own = models.find(m => m.service === s.service && m.id === s.model)?.efforts
    const any = [...new Set(modelsOf(s.service).flatMap(m => m.efforts))]
    const list = own?.length ? own : any
    return EFFORTS.filter(e => list.includes(e))
  }

  const setStep = (i: number, patch: Partial<BrainStep>) => edit(setSteps)(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    edit(setSteps)(next)
  }

  const recommend = async () => {
    try {
      const res = await fetch(`${officeHttpBase()}/brains/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier, effort, max: 3 }), signal: AbortSignal.timeout(10000),
      })
      if (res.ok) edit(setSteps)(((await res.json()).steps as BrainStep[]).map(s => ({ ...s, blocked: null })))
    } catch { /* keep what is there */ }
  }

  const customize = () => { edit(setAuto)(false) } // keeps the steps shown as the starting chain

  const save = async () => {
    const saved = await onSave({
      id: creating ? undefined : brain?.id,
      name: name.trim(),
      auto,
      ...(auto ? { tier, effort } : { steps: steps.map(s => ({ service: s.service, model: s.model, effort: s.effort })) }),
    })
    if (saved) setDirty(false)
  }

  const brainOptions = [
    ...overview.brains.map(b => ({ value: b.id, label: b.name })),
    { value: NEW, label: '+ New brain' },
  ]
  const installed = services.filter(s => s.available)
  const unsure = overview.catalogue.unsure
  const outdated = overview.catalogue.outdated ?? []

  return (
    <div className="brains">
      <p className="backend-lead">A brain is what an agent thinks with: a chain of models. When the first is used up or unavailable, the next takes over.</p>

      <div className="org-field">
        <label htmlFor="brain-pick">Brain</label>
        <ThemedSelect id="brain-pick" value={selectedId} options={brainOptions} onChange={onSelect} />
      </div>

      <div className="org-field">
        <label htmlFor="brain-name">Name</label>
        <div className="ts"><input id="brain-name" type="text" value={name} maxLength={40} disabled={readOnly} onChange={e => edit(setName)(e.target.value)} placeholder="Name" /></div>
      </div>

      <div className="org-field">
        <label htmlFor="brain-mode">Steps</label>
        <ThemedSelect
          id="brain-mode"
          value={auto ? 'auto' : 'custom'}
          disabled={readOnly}
          onChange={v => (v === 'auto' ? edit(setAuto)(true) : customize())}
          options={[
            { value: 'auto', label: 'Automatic: recommended from what is installed' },
            { value: 'custom', label: 'Custom: the steps I choose' },
          ]}
        />
      </div>

      <div className="org-field">
        <label htmlFor="brain-tier">For work that is</label>
        <ThemedSelect id="brain-tier" value={tier} disabled={readOnly} onChange={v => edit(setTier)(v as Tier)}
          options={(Object.keys(TIER_LABEL) as Tier[]).map(t => ({ value: t, label: TIER_LABEL[t] }))} />
      </div>
      <div className="org-field">
        <label htmlFor="brain-effort">Reasoning</label>
        <ThemedSelect id="brain-effort" value={effort} disabled={readOnly} onChange={edit(setEffort)}
          options={EFFORTS.map(e => ({ value: e, label: e }))} />
      </div>

      <ol className="brain-steps" aria-label="Steps, in the order they are tried">
        {steps.length === 0 && <li className="org-hint">{auto ? 'No model found for this: nothing is installed or listed yet.' : 'No steps yet.'}</li>}
        {steps.map((s, i) => (
          <li key={`${i}-${s.service}-${s.model}`} className={`brain-step${s.blocked ? ' is-blocked' : ''}`}>
            <span className="brain-n">{i + 1}</span>
            {auto ? (
              <div className="brain-auto">
                <strong>{label(s.service)}</strong> · {s.label || s.model || 'default model'}{s.effort ? ` · ${s.effort} reasoning` : ''}
                {s.why && <div className="org-hint">{s.why}</div>}
                {outdated.includes(s.service) && <div className="org-hint">{OUTDATED_NOTE}</div>}
              </div>
            ) : (
              <div className="brain-fields">
                <ThemedSelect id={`step-${i}-service`} value={s.service} disabled={readOnly}
                  onChange={v => setStep(i, { service: v, model: '', effort: '' })}
                  options={installed.map(x => ({ value: x.name, label: x.label }))} />
                <ModelCombo id={`step-${i}-model`} value={s.model} options={modelsOf(s.service)} placeholder="Default model" disabled={readOnly}
                  onChange={v => setStep(i, { model: v })} onCommit={() => undefined} />
                <ThemedSelect id={`step-${i}-effort`} value={s.effort} disabled={readOnly || effortsFor(s).length === 0}
                  onChange={v => setStep(i, { effort: v })}
                  options={[{ value: '', label: 'Default reasoning' }, ...effortsFor(s).map(e => ({ value: e, label: e }))]} />
                {outdated.includes(s.service) && <div className="org-hint">{OUTDATED_NOTE}</div>}
              </div>
            )}
            {s.blocked && (
              <div className="brain-blocked" role="status">
                {blockedText(s.blocked)} · {untilText(s.blocked.until)}
                {!readOnly && <button type="button" className="brain-link" onClick={() => onClearCooldown(s.model && s.blocked?.kind === 'model' ? `${s.service}/${s.model}` : s.service)}>Try now</button>}
              </div>
            )}
            {!auto && !readOnly && (
              <span className="brain-actions">
                <button type="button" className="brain-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="brain-icon" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="brain-icon" aria-label="Remove step" onClick={() => edit(setSteps)(steps.filter((_, k) => k !== i))}>✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>

      {!auto && !readOnly && (
        <div className="brain-toolbar">
          <button type="button" className="backend-secondary" disabled={steps.length >= 6 || installed.length === 0}
            onClick={() => edit(setSteps)([...steps, { service: installed[0].name, model: '', effort: '' }])}>+ Add fallback</button>
          <button type="button" className="backend-secondary" onClick={() => void recommend()}>Recommend steps</button>
        </div>
      )}

      <div className="backend-actions brain-save">
        {!creating && brain && !readOnly && (
          <button type="button" className="backend-secondary" onClick={() => onDelete(brain.id)}>{brain.builtin ? 'Reset to default' : 'Delete'}</button>
        )}
        <button type="button" className="backend-primary" disabled={readOnly || !name.trim() || (!auto && steps.length === 0) || (!dirty && !creating)} onClick={save}>
          {creating ? 'Create brain' : 'Save'}
        </button>
      </div>

      <p className="org-hint brain-foot">
        {overview.catalogue.count} models from {installed.length} services{unsure ? `, ${unsure} placed by their name alone (their tier is a guess)` : ''}.{' '}
        {!readOnly && <button type="button" className="brain-link" onClick={onRefresh}>Refresh the list</button>}
      </p>
    </div>
  )
}

export { NEW as NEW_BRAIN }
export type { Brain }
