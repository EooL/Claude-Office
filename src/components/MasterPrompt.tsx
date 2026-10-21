import React, { useEffect, useRef, useState } from 'react'
import { CvShell } from './JobDescription'
import { officeHttpBase } from '../serverUrl'
import { getUiToken } from '../permissions'
import { lineDiff, lineOffset, markdownToBlocks, problemText, type ProfileProblem } from '../jobDescription'

export interface MasterPromptProfile {
  text: string; defaultText: string; source: 'override' | 'shipped'; status: 'default' | 'draft' | 'approved'; hash: string; warnings: string[]
}
interface Props {
  readOnly: boolean; agentCount?: number; onDirtyChange?: (dirty: boolean) => void; onStatusChange?: (status: MasterPromptProfile['status']) => void
  initial?: { profile?: MasterPromptProfile; draft?: string; problems?: ProfileProblem[]; warnings?: string[]; checking?: boolean; showDiff?: boolean }
}
async function call(method: string, body?: unknown) {
  try {
    const token = getUiToken()
    const response = await fetch(`${officeHttpBase()}/master-prompt${method === 'POST' ? '/validate' : ''}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    const json = await response.json()
    return { ok: response.ok, body: json }
  } catch { return { ok: false, body: { error: 'Could not reach the office server.' } } }
}

/** Project-wide advice, edited without invoking any AI service. Text is always escaped by React. */
export default function MasterPrompt({ readOnly, agentCount = 13, onDirtyChange, onStatusChange, initial }: Props) {
  const [profile, setProfile] = useState(initial?.profile ?? null)
  const [draft, setDraft] = useState<string | null>(initial?.draft ?? null)
  const [problems, setProblems] = useState<ProfileProblem[]>(initial?.problems ?? [])
  const [warnings, setWarnings] = useState<string[]>(initial?.warnings ?? initial?.profile?.warnings ?? [])
  const [checking, setChecking] = useState(initial?.checking ?? false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [ask, setAsk] = useState<'close' | 'reset' | null>(null)
  const [showDiff, setShowDiff] = useState(initial?.showDiff ?? false)
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = draft !== null && profile !== null && draft !== profile.text
  useEffect(() => {
    let current = true
    void call('GET').then(r => { if (current) { if (r.ok) { setProfile(r.body); setWarnings(r.body.warnings ?? []) } else setNote(r.body.error ?? 'Could not load project rules.') } })
    return () => { current = false }
  }, [])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (profile) onStatusChange?.(profile.status) }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (draft === null) return
    let current = true
    setChecking(true)
    const timer = setTimeout(() => { void call('POST', { text: draft }).then(r => {
      if (!current) return
      setProblems(r.ok ? (r.body.ok ? [] : r.body.errors?.length ? r.body.errors : [{ message: 'Validation failed.' }]) : [{ message: r.body.error ?? 'Could not validate.' }])
      setWarnings(r.body.warnings ?? []); setChecking(false)
    }) }, 400)
    return () => { current = false; clearTimeout(timer) }
  }, [draft])
  useEffect(() => { if (draft !== null) area.current?.focus() }, [draft === null]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const element = area.current; if (element) { element.style.height = 'auto'; element.style.height = `${element.scrollHeight + 2}px` } }, [draft])
  const close = () => { if (dirty && ask !== 'close') setAsk('close'); else { setDraft(null); setAsk(null); setProblems([]); setWarnings(profile?.warnings ?? []) } }
  const save = async (status: 'draft' | 'approved') => {
    if (readOnly || !getUiToken() || draft === null || checking || problems.length || busy) return
    setBusy(true)
    const r = await call('PUT', { text: draft, status })
    if (r.ok) { setProfile(r.body); setDraft(null); setProblems([]); setWarnings(r.body.warnings ?? []); setNote(status === 'approved' ? 'Saved and approved.' : 'Saved as a draft.') }
    else { setProblems(r.body.errors ?? []); setNote(r.body.error ?? 'Could not save project rules.') }
    setBusy(false)
  }
  const reset = async () => {
    if (readOnly || !getUiToken() || busy) return
    setBusy(true); setAsk(null)
    const r = await call('DELETE')
    if (r.ok) { setProfile(r.body); setDraft(null); setProblems([]); setWarnings(r.body.warnings ?? []); setNote('Back to the shipped default.') }
    else setNote(r.body.error ?? 'Could not reset project rules.')
    setBusy(false)
  }
  const blocks = markdownToBlocks(draft ?? profile?.text ?? '')
  const diff = profile && showDiff ? lineDiff(profile.defaultText, draft ?? profile.text).filter(l => l.op !== ' ') : []
  const sidebar = <>
    <section className="cv-block"><h4>Applies to</h4><p>{`All ${agentCount} agents + Chat and Orchestrator (2 operations).`}</p></section>
    <section className="cv-block"><h4>Variables</h4><p><code>{'{{project}}'}</code>: the project folder.</p><p><code>{'{{office}}'}</code>: the office name.</p></section>
    <section className="cv-block"><h4>Size</h4><p>{`${new TextEncoder().encode(draft ?? profile?.text ?? '').length} bytes of 8 KB`}</p></section>
  </>
  const actions = profile && <div className="jd-actions cv-actions">
    {!readOnly && draft === null && <button type="button" className="backend-secondary" onClick={() => { setChecking(true); setDraft(profile.text) }}>Edit project rules</button>}
    <button type="button" className="backend-secondary" aria-pressed={showDiff} onClick={() => setShowDiff(!showDiff)}>Show changes</button>
    {!readOnly && profile.source === 'override' && <button type="button" className="backend-secondary" disabled={busy} onClick={() => setAsk('reset')}>Reset to default</button>}
  </div>
  const notices = <div className="cv-notices">
    {ask === 'close' && <p className="jd-confirm" role="alert">Discard your unsaved changes? Press Escape again, or <button type="button" className="brain-link" onClick={() => setAsk(null)}>keep editing</button>.</p>}
    {ask === 'reset' && <p className="jd-confirm" role="alert">Replace the project rules and discard any unsaved changes? <button type="button" className="backend-secondary" onClick={() => void reset()}>Yes, reset</button> <button type="button" className="brain-link" onClick={() => setAsk(null)}>Cancel</button></p>}
    {note && <p role="status">{note}</p>}
    {draft !== null && <p role="status" aria-live="polite">{checking ? 'Checking…' : problems.length ? `${problems.length} errors` : 'Valid'}</p>}
  </div>
  const main = <>
    {warnings.length > 0 && <ul className="jd-warnings" role="status">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    {profile && (draft === null || readOnly ? <div className="cv-sections">{blocks.map((b, i) => b.type === 'h' ? <h4 key={i}>{b.text}</h4> : <p key={i} className={b.type === 'li' ? 'jd-li' : undefined}>{b.text}</p>)}</div> : <div className="jd-editor">
      <label htmlFor="master-text">Project rules (Markdown)</label>
      <textarea id="master-text" ref={area} className="jd-text" spellCheck={false} value={draft} rows={Math.max(24, draft.split('\n').length + 1)} onChange={e => { setChecking(true); setDraft(e.target.value) }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }} />
      {problems.length > 0 && <ul className="jd-problems" role="alert">{problems.map((p, i) => <li key={i}>{p.line ? <button type="button" className="brain-link" onClick={() => { const element = area.current; if (element) { const offset = lineOffset(draft, p.line!); element.focus(); element.setSelectionRange(offset, offset); element.scrollIntoView({ block: 'nearest' }) } }}>{problemText(p)}</button> : problemText(p)}</li>)}</ul>}
      <div className="jd-actions"><button type="button" className="backend-primary" disabled={busy || checking || problems.length > 0} onClick={() => void save('draft')}>Save (draft)</button><button type="button" className="backend-primary" disabled={busy || checking || problems.length > 0} onClick={() => void save('approved')}>Save and approve</button><button type="button" className="backend-secondary" onClick={close}>Cancel</button></div>
    </div>)}
    {showDiff && profile && <div className="jd-diff" aria-label="Changes against the default">{diff.length ? diff.map((l, i) => <div key={i} className={l.op === '+' ? 'is-add' : 'is-del'}>{l.op} {l.text}</div>) : <p>No changes against the default.</p>}</div>}
    {readOnly && <p className="org-hint">Read-only: open the office with its link to edit.</p>}
  </>
  return <div className="jd"><CvShell portrait={<span className="cv-portrait cv-project" role="img" aria-label="Project">▣</span>} name="Project rules" headline="The rules every agent follows, before its own job description" chips={profile && <span className={`jd-status is-${profile.status}`}>{profile.status}</span>} sidebar={sidebar} actions={actions} notices={notices} main={main} /></div>
}
