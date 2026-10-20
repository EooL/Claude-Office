/**
 * SettingsPanel — the office settings dialog, and the first-run start screen.
 *
 * Tabs, in the order things are set up:
 *   Services  the AI services the office may use: each installed one can be enabled or not (only enabled ones
 *             are run, listed or offered anywhere), and one is the default
 *   Brains    Brain Profiles: chains of models with a fallback to the next when one is used up or unavailable
 *   Team      who thinks with what: the org chart, Boss > Chat and Orchestrator > the agents; click a node to
 *             choose its brain
 * Add a tab by adding it to TABS and a panel below; each panel is made of <section className="settings-section">.
 *
 * Services come from GET /backends (every service the office knows, whether its CLI is on this machine's PATH and
 * whether Settings enables it), brains from GET /brains. Changes need the UI token.
 *
 * Two ways in: the first run (no saved choice, or the saved service is gone) opens it by itself and the first
 * service chosen is the one enabled; afterwards the gear button in the title bar sets `open`, and the dialog can
 * be dismissed (Close, Esc, a click outside).
 *
 * Logos: /logos/<name>.svg from public/ when the file exists, else a coloured initial.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { officeHttpBase } from '../serverUrl'
import { getUiToken } from '../permissions'
import type { BrainsOverview, CatalogueModel } from '../brains'
import BrainsPanel from './BrainsPanel'
import OrgChart from './OrgChart'
import ThemedSelect from './ThemedSelect'
import '../styles/settings.css'
import { setEventMode, useEventMode, type EventMode } from '../eventMode'

interface Service {
  name: string
  label: string
  bin: string
  available: boolean
  enabled: boolean
  /** the CLI has a mode that skips every permission prompt (used for an approved plan only) */
  fullAccessSupported?: boolean
  fullAccess?: boolean
  install?: string
  docs: string
  setup: string
}

interface Role {
  role: string
  name: string
  reportsTo: string | null
}

interface BackendsResponse {
  services: Service[]
  selected: string
  confirmed: boolean
  roles: Role[]
}

const BRAND_COLOURS: Record<string, string> = {
  claude: '#d97757', codex: '#10a37f', agy: '#4285f4', opencode: '#8b8d91', qoder: '#7c5cff',
}

function Logo({ service }: { service: Service }) {
  const [missing, setMissing] = useState(false)
  if (!missing) {
    return <img className="backend-logo" src={`/logos/${service.name}.svg`} alt="" width={20} height={20} onError={() => setMissing(true)} />
  }
  return (
    <span className="backend-logo backend-logo-initial" style={{ background: BRAND_COLOURS[service.name] ?? '#4a4d55' }} aria-hidden="true">
      {service.label.charAt(0)}
    </span>
  )
}

const TABS = [
  { id: 'services', label: 'Services' },
  { id: 'brains', label: 'Brains' },
  { id: 'team', label: 'Team' },
  { id: 'events', label: 'Events' },
] as const

type Tab = (typeof TABS)[number]['id']

/** Send JSON with the UI token to the office server; { ok, body } (body null when it could not be read). */
async function send(method: string, path: string, body?: unknown): Promise<{ ok: boolean; body: any; error?: string }> {
  const token = getUiToken()
  if (!token) return { ok: false, body: null, error: 'Not connected to the office yet, try again in a moment.' }
  try {
    const res = await fetch(`${officeHttpBase()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, body: json, error: res.ok ? undefined : json?.error ?? 'Could not save the change.' }
  } catch {
    return { ok: false, body: null, error: 'Could not reach the office server.' }
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${officeHttpBase()}${path}`, { signal: AbortSignal.timeout(30000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export default function SettingsPanel({ readOnly, open, onClose }: { readOnly: boolean; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<BackendsResponse | null>(null)
  const [overview, setOverview] = useState<BrainsOverview | null>(null)
  const [models, setModels] = useState<CatalogueModel[]>([])
  const [firstRun, setFirstRun] = useState(false) // must be answered; Settings can be dismissed
  const [focus, setFocus] = useState<string | null>(null) // the service whose setup steps show
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('services')
  const [brainId, setBrainId] = useState('deep')
  const eventMode = useEventMode()
  const [savingEvents, setSavingEvents] = useState(false)

  const load = useCallback(async (): Promise<BackendsResponse | null> => {
    const body = await getJson<BackendsResponse>('/backends')
    if (body) setData(body)
    return body // an older server has no /backends: no start screen
  }, [])
  const loadBrains = useCallback(async () => {
    const body = await getJson<BrainsOverview>('/brains')
    if (body) setOverview(body)
    return body
  }, [])
  const loadModels = useCallback(async () => {
    const body = await getJson<{ models: CatalogueModel[] }>('/brains/catalogue')
    if (body) setModels(body.models)
  }, [])

  useEffect(() => {
    void load().then(body => {
      if (!body) return
      setFocus(body.selected)
      if (!body.confirmed) setFirstRun(true)
    })
  }, [load])

  const visible = firstRun || open

  useEffect(() => {
    if (!open) return
    setError(null)
    void load().then(body => { if (body) setFocus(body.selected) }) // availability may have changed
    void loadBrains()
  }, [open, load, loadBrains])
  useEffect(() => { if (open && tab === 'brains') void loadModels() }, [open, tab, loadModels])

  useEffect(() => {
    if (!visible || firstRun) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, firstRun, onClose])

  if (!data) return null
  if (!visible) return null

  const current = data.services.find(s => s.name === focus) ?? data.services[0]
  const label = (service: string) => data.services.find(s => s.name === service)?.label ?? service
  const defaultService = data.services.find(s => s.name === data.selected)
  const nothingEnabled = !data.services.some(s => s.available && s.enabled)

  /** Run a change, show its error, and take the fresh brains overview it returns */
  const changeBrains = async (method: string, path: string, body?: unknown) => {
    setError(null)
    const r = await send(method, path, body)
    if (!r.ok) { setError(r.error ?? null); return null }
    if (r.body?.brains) setOverview(r.body)
    return r.body
  }

  const choose = async () => {
    setError(null)
    const r = await send('POST', '/backends/select', { name: current.name })
    if (!r.ok) { setError(r.error ?? null); return }
    setData({ ...data, selected: current.name, confirmed: true, services: data.services.map(s => (s.name === current.name ? { ...s, enabled: true } : s)) })
    setFirstRun(false)
    void loadBrains()
    onClose()
  }

  const setFullAccess = async (name: string, enabled: boolean) => {
    setError(null)
    const r = await send('POST', '/backends/full-access', { name, enabled })
    if (!r.ok) { setError(r.error ?? null); return }
    setData({ ...data, services: r.body.services })
  }

  const setEnabled = async (name: string, enabled: boolean) => {
    setError(null)
    const r = await send('POST', '/backends/enable', { name, enabled })
    if (!r.ok) { setError(r.error ?? null); return }
    setData({ ...data, services: r.body.services })
    void loadBrains() // the models, and so the recommendations, now come only from the enabled services
  }

  const servicesSection = (
    <section className="settings-section" id="settings-panel-services" role={firstRun ? undefined : 'tabpanel'} aria-labelledby={firstRun ? undefined : 'settings-tab-services'}>
      <p className="backend-lead">
        {firstRun
          ? 'It answers the office chat and runs agents you start from here. You can allow more services later in Settings (the gear in the title bar).'
          : 'The office only uses a service that is installed and turned on here. Nothing is run, listed or sent to the others.'}
      </p>

      <ul className="backend-list">
        {data.services.map(s => (
          <li key={s.name} className={!firstRun && s.available && !s.enabled ? 'is-off' : undefined}>
            <div className={`backend-option${s.name === current.name ? ' is-focused' : ''}${s.available ? '' : ' is-missing'}`}>
              <button type="button" className="backend-pick" onClick={() => { setFocus(s.name); setError(null) }} aria-pressed={s.name === current.name}>
                <Logo service={s} />
                <span className="backend-name">{s.label}</span>
                {!firstRun && s.name === data.selected && <span className="backend-badge current">Default</span>}
                <span className={`backend-badge ${s.available ? 'ok' : 'missing'}`}>{s.available ? 'Installed' : 'Not installed'}</span>
              </button>
              {!firstRun && s.available && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label={`Allow ${s.label}`}
                  className={`switch${s.enabled ? ' is-on' : ''}`}
                  disabled={readOnly}
                  onClick={() => void setEnabled(s.name, !s.enabled)}
                ><span className="switch-knob" /></button>
              )}
            </div>
            {!firstRun && s.available && s.enabled && s.fullAccessSupported && (
              <div className="full-access">
                <span className="full-access-text">
                  <strong>Full tool access</strong> when an agent writes files (approved plans and <code>run:{s.name}</code>). {s.label} cannot ask permission here, so it
                  refuses any command it has no allow-rule for. On, it runs any command without asking. Chat and planning
                  stay restricted.
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!s.fullAccess}
                  aria-label={`Full tool access for ${s.label}`}
                  className={`switch${s.fullAccess ? ' is-on is-warn' : ''}`}
                  disabled={readOnly}
                  onClick={() => void setFullAccess(s.name, !s.fullAccess)}
                ><span className="switch-knob" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {nothingEnabled && !firstRun && <p className="backend-error" role="alert">No service is turned on, so the chat and the agents cannot answer. Turn one on above.</p>}

      {!current.available && (
        <div className="backend-help">
          <p><strong>{current.label}</strong> was not found on this machine (looked for <code>{current.bin}</code> on your PATH).</p>
          <ol>
            {current.install && <li>Install: <code>{current.install}</code></li>}
            <li>Docs: <a href={current.docs} target="_blank" rel="noreferrer">{current.docs}</a></li>
            <li>{current.setup}</li>
          </ol>
        </div>
      )}

      {readOnly && <p className="backend-note">This page is read-only. Open the office with its link (<code>npm run open</code>) to choose.</p>}
      {error && <p className="backend-error" role="alert">{error}</p>}

      <div className="backend-actions">
        {!current.available && <button type="button" className="backend-secondary" onClick={() => void load()}>Check again</button>}
        <button type="button" className="backend-primary" disabled={readOnly || !current.available || (!firstRun && current.name === data.selected)} onClick={() => void choose()}>
          {firstRun ? `Continue with ${current.label}` : current.name === data.selected ? `${current.label} is the default` : `Make ${current.label} the default`}
        </button>
      </div>
      {!firstRun && <p className="org-hint">The default service is used by the chat and the orchestrator until you choose a brain for them (Team).</p>}
    </section>
  )

  return (
    <div className="backend-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => { if (e.target === e.currentTarget && !firstRun) onClose() }}>
      <div className="backend-card settings-card">
        <h2 id="settings-title">{firstRun ? 'Choose your AI service' : 'Settings'}</h2>

        {!firstRun && (
          <div className="settings-tabs" role="tablist" aria-label="Settings">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`settings-panel-${t.id}`}
                className={`settings-tab${tab === t.id ? ' is-active' : ''}`}
                onClick={() => { setTab(t.id); setError(null) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {firstRun && servicesSection}

        {!firstRun && tab === 'services' && servicesSection}

        {!firstRun && tab === 'events' && (
          <section className="settings-section" id="settings-panel-events" role="tabpanel" aria-labelledby="settings-tab-events">
            <p className="backend-lead">Choose what drives office alerts.</p>
            <label htmlFor="event-mode">Event source</label>
            <ThemedSelect id="event-mode" value={eventMode} disabled={readOnly || savingEvents} onChange={async value => {
              const next = value as EventMode
              setSavingEvents(true); setError(null)
              const result = await send('POST', '/settings', { eventMode: next })
              if (result.ok) setEventMode(next)
              else setError(result.error ?? 'Could not save event source.')
              setSavingEvents(false)
            }} options={[
              { value: 'real', label: 'Real events (default)' },
              { value: 'emulated', label: 'Real events + emulated office events' },
            ]} />
            <p className="backend-note">Real mode uses observed tool failures and test, build, push and deployment signals. It never invents deployment outcomes. CI can report authenticated signals through the Office event API; pipelines without an integration are not monitored.</p>
            <p className="backend-note">Emulated events are labeled and add fictional office activity. Real signals remain enabled in both modes.</p>
            {error && <p className="backend-error" role="alert">{error}</p>}
          </section>
        )}

        {!firstRun && tab === 'team' && (
          <section className="settings-section" id="settings-panel-team" role="tabpanel" aria-labelledby="settings-tab-team">
            <p className="backend-lead">Who thinks with what. Click the chat, the orchestrator or an agent to choose its brain.</p>
            {overview ? (
              <OrgChart
                roles={data.roles}
                overview={overview}
                serviceLabel={label}
                defaultLabel={defaultService ? defaultService.label : 'none'}
                readOnly={readOnly}
                onLink={(role, brain) => void changeBrains('POST', '/brains/link', { role, brain })}
                onLinkOperation={(operation, brain) => void changeBrains('POST', '/brains/operation', { operation, brain })}
                onEditBrain={id => { setBrainId(id); setTab('brains') }}
                onAutoAssign={async () => {
                  const body = await changeBrains('POST', '/brains/auto-assign', {})
                  return body?.assigned ? Object.keys(body.assigned).length : 0
                }}
              />
            ) : <p className="org-hint">Loading…</p>}
            {readOnly && <p className="backend-note">This page is read-only. Open the office with its link (<code>npm run open</code>) to change this.</p>}
            {error && <p className="backend-error" role="alert">{error}</p>}
          </section>
        )}

        {!firstRun && tab === 'brains' && (
          <section className="settings-section" id="settings-panel-brains" role="tabpanel" aria-labelledby="settings-tab-brains">
            {overview ? (
              <BrainsPanel
                overview={overview}
                services={data.services.filter(s => s.available && s.enabled)}
                models={models}
                readOnly={readOnly}
                selectedId={brainId}
                onSelect={setBrainId}
                onSave={async brain => {
                  const body = await changeBrains('POST', '/brains', brain)
                  const made = body?.brains?.find((b: { name: string }) => b.name === brain.name)
                  if (made) setBrainId(made.id)
                  return Boolean(body)
                }}
                onDelete={async id => {
                  await changeBrains('DELETE', `/brains/${encodeURIComponent(id)}`)
                  setBrainId('deep')
                }}
                onClearCooldown={key => void changeBrains('POST', '/brains/cooldowns/clear', { key })}
                onRefresh={async () => { await changeBrains('POST', '/brains/refresh'); void loadModels() }}
              />
            ) : <p className="org-hint">Loading…</p>}
            {readOnly && <p className="backend-note">This page is read-only. Open the office with its link (<code>npm run open</code>) to change this.</p>}
            {error && <p className="backend-error" role="alert">{error}</p>}
          </section>
        )}

        {!firstRun && (
          <div className="settings-footer">
            <button type="button" className="backend-secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
