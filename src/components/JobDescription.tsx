/**
 * JobDescription — one agent's CV in the Team tab's right pane (server/agent-profiles.mjs): a header with the
 * portrait, name, status and who it reports to, a compact action bar, a sidebar (brain, access, tools, model) and the
 * job description sections as the main column. The parent picks the role and supplies the brain block.
 * Editors (Edit, Save, Approve, Reset, Enrich) need the UI token (`readOnly` false). Text is only ever rendered as
 * React text, never as HTML. `initial` seeds the state (tests, and no flash when the parent already knows it).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { officeHttpBase } from '../serverUrl'
import { getUiToken } from '../permissions'
import { lineDiff, lineOffset, markdownToBlocks, problemText, type Block, type ProfileProblem } from '../jobDescription'
import { getAvatarSrc } from './SlackChat'
import ResilientImg from './ResilientImg'
import '../styles/job-description.css'

export interface ProfileSummary { role: string; displayName: string; status: string }
interface AccessCheck { mode: string; wanted: string; guaranteed: boolean; message: string }
export interface Profile {
  role: string
  text: string
  defaultText: string
  frontmatter?: { description?: string; tools?: string[]; disallowedTools?: string[]; model?: string; effort?: string; office?: { displayName?: string; reportsTo?: string; escalatesTo?: string; status?: string; access?: Record<string, string> } }
  source: string
  warnings?: string[]
  accessChecks?: Record<string, AccessCheck[]>
  accessSummary?: { count: number; text: string; byService: { service: string; label?: string; issues: { mode: string; wanted: string; guaranteed: boolean }[] }[] }
}
type Problem = ProfileProblem
export interface CvPerson { role: string; name: string }

interface Props {
  roleId: string | null
  /** The agent's display name from the org chart (the profile's own name wins once loaded) */
  name: string
  readOnly: boolean
  serviceLabel: (service: string) => string
  /** The Brain block of the sidebar (the select, its chain and the recommendation) */
  brain: React.ReactNode
  reportsTo?: CvPerson | null
  manages?: CvPerson[]
  /** A name in the header was clicked: select that node in the tree */
  onSelect?: (role: string) => void
  /** A role id as a name ('boss' and unknown ids come back as they are) */
  nameOf?: (role: string) => string
  /** The editor holds unsaved changes (or no longer does) */
  onDirtyChange?: (dirty: boolean) => void
  /** The role's job description state, once loaded and after every save or reset */
  onStatusChange?: (role: string, status: string) => void
  initial?: { profile?: Profile; error?: string; draft?: string; problems?: Problem[]; checking?: boolean; accessExpanded?: boolean }
}

async function call(method: string, path: string, body?: unknown, auth = false): Promise<{ ok: boolean; body: any; error?: string }> {
  const token = getUiToken()
  if (auth && !token) return { ok: false, body: null, error: 'Not connected to the office yet, try again in a moment.' }
  try {
    const res = await fetch(`${officeHttpBase()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const json = await res.json().catch(() => null)
    const msg = json?.errors?.length ? json.errors.map((e: Problem) => e.message).join('; ') : json?.error
    return { ok: res.ok, body: json, error: res.ok ? undefined : msg ?? (res.status === 404 ? 'Not available on this office server.' : `The server answered ${res.status}.`) }
  } catch {
    return { ok: false, body: null, error: 'Could not reach the office server.' }
  }
}

/** The CV frame: header band (portrait, name, headline, extras), optional action bar, sidebar and main column. */
export function CvShell({ portrait, name, roleId, headline, chips, extras, actions, notices, sidebar, main }: {
  portrait: string | React.ReactElement; name: string; roleId?: string; headline?: string
  chips?: React.ReactNode; extras?: React.ReactNode; actions?: React.ReactNode; notices?: React.ReactNode
  sidebar: React.ReactNode; main: React.ReactNode
}) {
  return (
    <div className="cv">
      {/* sticky: stays visible while the sections scroll in .org-right */}
      <header className="cv-head is-sticky">
        {typeof portrait === 'string' ? <ResilientImg className="cv-portrait" src={portrait} alt={name} width={56} height={56} /> : portrait}
        <div className="cv-id">
          <div className="cv-titlerow">
            <h3 className="cv-name">{name}{roleId && <code className="cv-role">{roleId}</code>}</h3>
            {chips}
          </div>
          {headline && <p className="cv-headline" title={headline}>{headline}</p>}
          {extras}
        </div>
        {actions}
        {notices}
      </header>
      <div className="cv-cols">
        <aside className="cv-side">{sidebar}</aside>
        <div className="cv-main">{main}</div>
      </div>
    </div>
  )
}

const MUST_NOT = /must not/i

/** The body as sections: a heading and its blocks (text before the first heading has no heading). */
function sectionsOf(blocks: Block[]): { heading?: string; blocks: Block[] }[] {
  const out: { heading?: string; blocks: Block[] }[] = []
  for (const b of blocks) {
    if (b.type === 'h') out.push({ heading: b.text, blocks: [] })
    else { if (!out.length) out.push({ blocks: [] }); out[out.length - 1].blocks.push(b) }
  }
  return out
}

export default function JobDescription({ roleId, name, readOnly, serviceLabel, brain, reportsTo, manages = [], onSelect, nameOf, onDirtyChange, onStatusChange, initial }: Props) {
  const [profile, setProfile] = useState<Profile | null>(initial?.profile ?? null)
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<string | null>(initial?.draft ?? null) // non-null while editing
  const [problems, setProblems] = useState<Problem[]>(initial?.problems ?? [])
  const [checking, setChecking] = useState(initial?.checking ?? false)
  const [accessExpanded, setAccessExpanded] = useState(initial?.accessExpanded ?? false)
  const [note, setNote] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [ask, setAsk] = useState<'reset' | 'close' | null>(null)
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async (role: string) => {
    setLoading(true); setError(null); setDraft(null); setAsk(null); setNote(null); setShowDiff(false); setChecking(false); setProblems([]); setAccessExpanded(false)
    const r = await call('GET', `/profiles/${encodeURIComponent(role)}`)
    if (r.ok && r.body) setProfile(r.body); else { setProfile(null); setError(r.error ?? 'Could not load the job description.') }
    setLoading(false)
  }, [])
  useEffect(() => { if (roleId) void load(roleId) }, [roleId, load])

  // live validation, debounced
  useEffect(() => {
    if (draft === null || !roleId) return
    let current = true
    setChecking(true)
    const timer = setTimeout(() => {
      void call('POST', `/profiles/${encodeURIComponent(roleId)}/validate`, { text: draft }).then(r => {
        if (!current) return
        setProblems(r.ok && r.body ? (r.body.ok ? [] : r.body.errors?.length ? r.body.errors : [{ message: 'Validation failed.' }]) : [{ message: r.error ?? 'Could not validate.' }])
        setChecking(false)
      })
    }, 400)
    return () => { current = false; clearTimeout(timer) }
  }, [draft, roleId])
  useEffect(() => { if (draft !== null) area.current?.focus() }, [draft === null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = area.current
    if (element && draft !== null) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight + 2}px` }
  }, [draft])

  const base = `/profiles/${encodeURIComponent(roleId ?? '')}`
  const dirty = draft !== null && profile !== null && draft !== profile.text
  const close = () => { if (dirty && ask !== 'close') setAsk('close'); else { setDraft(null); setAsk(null); setProblems([]) } }

  const save = async (status: 'draft' | 'approved') => {
    if (draft === null || checking || problems.length > 0) return
    setBusy(true); setNote(null)
    const r = await call('PUT', base, { text: draft, status }, true)
    if (r.ok && r.body) { setProfile(r.body); setDraft(null); setProblems([]); setNote(status === 'approved' ? 'Saved and approved.' : 'Saved as a draft.') }
    else { if (Array.isArray(r.body?.errors)) setProblems(r.body.errors); setNote(r.error ?? 'Could not save.') }
    setBusy(false)
  }
  const reset = async () => {
    setBusy(true); setAsk(null)
    const r = await call('DELETE', base, undefined, true)
    if (r.ok) { setDraft(null); await load(roleId ?? ''); setNote('Back to the shipped default.') } else setNote(r.error ?? 'Could not reset.')
    setBusy(false)
  }
  const enrich = async () => {
    setBusy(true); setNote(null)
    const r = await call('POST', `${base}/enrich`, {}, true)
    if (r.ok && typeof r.body?.text === 'string') { setChecking(true); setDraft(r.body.text); setNote('Enriched draft below: review it, then Save. Nothing is saved yet.') }
    else setNote(r.error ?? 'Enrich is not available on this office server.')
    setBusy(false)
  }

  const fm = profile?.frontmatter
  const office = fm?.office
  const status = office?.status ?? 'default'
  const summary = profile?.accessSummary
  const sections = profile ? sectionsOf(markdownToBlocks(profile.text)) : []
  const headline = fm?.description || sections.find(s => s.heading && /who you are/i.test(s.heading))?.blocks.find(b => b.type === 'p')?.text
  const escalates = office?.escalatesTo
  useEffect(() => { if (profile && profile.role === roleId) onStatusChange?.(profile.role, status) }, [profile, roleId, status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps
  const diff = profile && showDiff ? lineDiff(profile.defaultText, draft ?? profile.text).filter(l => l.op !== ' ') : []
  const person = (p: CvPerson) => <button type="button" className="brain-link cv-person" onClick={() => onSelect?.(p.role)}>{p.name}</button>

  const chips = profile && <span className={`jd-status is-${status}`} title={`Job description: ${status} (source: ${profile.source})`}>{status}</span>
  const extras = (
    <p className="cv-meta">
      <span className="cv-item"><span className="cv-label">Reports to:</span> {reportsTo ? person(reportsTo) : 'the orchestrator'}</span>
      {manages.length > 0 && <span className="cv-item"><span className="cv-label">Manages:</span> {manages.map((m, i) => <React.Fragment key={m.role}>{i > 0 && ', '}{person(m)}</React.Fragment>)}</span>}
      {escalates && <span className="cv-item"><span className="cv-label">Escalates to:</span> {escalates === 'boss' ? 'the boss' : nameOf?.(escalates) ?? escalates}</span>}
    </p>
  )

  const actions = profile && (
    <div className="jd-actions cv-actions">
      {draft === null && !readOnly && <button type="button" className="backend-secondary" onClick={() => { setChecking(true); setDraft(profile.text) }}>Edit job description</button>}
      <button type="button" className="backend-secondary" aria-pressed={showDiff} onClick={() => setShowDiff(!showDiff)}>Show changes</button>
      {!readOnly && <button type="button" className="backend-secondary" disabled={busy} onClick={() => void enrich()}>Enrich draft</button>}
      <a className="backend-secondary jd-link" href={`${officeHttpBase()}${base}/claude`} download title="Export Claude Code agent">Claude agent file</a>
      <a className="backend-secondary jd-link" href={`${officeHttpBase()}${base}/card`} target="_blank" rel="noreferrer" title="Download A2A card">A2A card</a>
      {!readOnly && profile.source === 'override' && <button type="button" className="backend-secondary" disabled={busy} onClick={() => setAsk('reset')}>Reset to default</button>}
    </div>
  )

  const access = Object.entries(office?.access ?? {})
  const sidebar = (
    <>
      <section className="cv-block"><h4>Brain</h4>{brain}</section>
      {profile && (
        <>
          <section className="cv-block">
            <h4>Access</h4>
            {access.length > 0 && <ul className="jd-chips" aria-label="Access">{access.map(([k, v]) => <li key={k} className="jd-chip"><span>{k}</span> {String(v)}</li>)}</ul>}
            {summary && summary.count > 0 && (
              <div className="jd-access">
                <p>{summary.text} <button type="button" className="brain-link" aria-expanded={accessExpanded} onClick={() => setAccessExpanded(!accessExpanded)}>Details</button></p>
                {accessExpanded && <ul>{summary.byService.map(s => <li key={s.service}>{serviceLabel(s.service)}<ul>{s.issues.map((issue, i) => <li key={i}>{`${issue.mode}: ${issue.wanted} ${issue.guaranteed ? 'guaranteed' : 'cannot be guaranteed'}`}</li>)}</ul></li>)}</ul>}
              </div>
            )}
          </section>
          <section className="cv-block">
            <h4>Tools</h4>
            <ul className="jd-chips" aria-label="Tools">
              {(fm?.tools ?? []).map(t => <li key={`t-${t}`} className="jd-chip">{t}</li>)}
              {(fm?.tools ?? []).length === 0 && <li className="org-hint">No tool list.</li>}
            </ul>
            {(fm?.disallowedTools ?? []).length > 0 && (
              <>
                <p className="cv-sub">Not allowed</p>
                <ul className="jd-chips is-denied" aria-label="Not allowed">{fm!.disallowedTools!.map(t => <li key={`d-${t}`} className="jd-chip">{t}</li>)}</ul>
              </>
            )}
          </section>
          <section className="cv-block">
            <h4>Model</h4>
            <ul className="jd-chips" aria-label="Model">
              <li className="jd-chip"><span>Tier</span> {fm?.model ?? 'default'}</li>
              <li className="jd-chip"><span>Effort</span> {fm?.effort ?? 'default'}</li>
            </ul>
          </section>
        </>
      )}
    </>
  )

  const main = (
    <>
      {loading && <p className="org-hint">Loading…</p>}
      {error && <p className="backend-error" role="alert">{error}</p>}
      {profile && (
        <>
          {(profile.warnings ?? []).length > 0 && (
            <ul className="jd-warnings" role="status">{profile.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {draft === null ? (
            <div className="cv-sections">
              {sections.map((s, i) => (
                <section key={i} className={`cv-section${s.heading && MUST_NOT.test(s.heading) ? ' is-must-not' : ''}`}>
                  {s.heading && <h4>{s.heading}</h4>}
                  {s.blocks.map((b, j) => b.type === 'li' ? <p key={j} className="jd-li">{b.text}</p> : <p key={j}>{b.text}</p>)}
                </section>
              ))}
            </div>
          ) : (
            <div className="jd-editor">
              <label htmlFor="jd-text">Job description text (Markdown with frontmatter)</label>
              <textarea
                id="jd-text" ref={area} className="jd-text" spellCheck={false} value={draft}
                rows={Math.max(24, draft.split('\n').length + 1)}
                onChange={e => { setChecking(true); setDraft(e.target.value) }}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
              />
              {problems.length > 0 && <ul className="jd-problems" role="alert">{problems.map((p, i) => <li key={i}>{p.line ? <button type="button" className="brain-link" onClick={() => { const element = area.current; if (element) { const offset = lineOffset(draft, p.line!); element.focus(); element.setSelectionRange(offset, offset); element.scrollIntoView({ block: 'nearest' }) } }}>{problemText(p)}</button> : problemText(p)}</li>)}</ul>}
              <div className="jd-actions">
                <button type="button" className="backend-primary" disabled={busy || readOnly || checking || problems.length > 0} onClick={() => void save('draft')}>Save (draft)</button>
                <button type="button" className="backend-primary" disabled={busy || readOnly || checking || problems.length > 0} onClick={() => void save('approved')}>Save and approve</button>
                <button type="button" className="backend-secondary" onClick={close}>Cancel</button>
              </div>
            </div>
          )}

          {showDiff && (
            <div className="jd-diff" aria-label="Changes against the default">
              {diff.length === 0 ? <p className="org-hint">No changes against the default.</p> : diff.map((l, i) => <div key={i} className={l.op === '+' ? 'is-add' : 'is-del'}>{l.op} {l.text}</div>)}
            </div>
          )}

          {readOnly && <p className="org-hint">Read-only: open the office with its link to edit.</p>}
        </>
      )}
    </>
  )

  // inside the sticky header: the confirms, the save note and the editor's validation status stay in view
  const notices = profile && (
    <div className="cv-notices">
      {ask === 'close' && <p className="jd-confirm" role="alert">Discard your unsaved changes? Press Escape again, or <button type="button" className="brain-link" onClick={() => setAsk(null)}>keep editing</button>.</p>}
      {ask === 'reset' && (
        <p className="jd-confirm" role="alert">Replace this job description with the shipped default?{' '}
          <button type="button" className="backend-secondary" onClick={() => void reset()}>Yes, reset</button>{' '}
          <button type="button" className="brain-link" onClick={() => setAsk(null)}>Cancel</button></p>
      )}
      {note && <p className="org-hint" role="status">{note}</p>}
      {draft !== null && <p className="org-hint" role="status" aria-live="polite">{checking ? 'Checking…' : problems.length > 0 ? `${problems.length} errors` : 'Valid'}</p>}
    </div>
  )

  return (
    <div className="jd">
      <CvShell portrait={getAvatarSrc(roleId ?? 'assistant')} name={office?.displayName ?? name} roleId={roleId ?? undefined} headline={headline} chips={chips} extras={extras} actions={actions} notices={notices} sidebar={sidebar} main={main} />
    </div>
  )
}
