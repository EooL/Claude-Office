import React, { useEffect, useState } from 'react'
import { officeHttpBase } from '../serverUrl'
import { getUiToken } from '../permissions'

export interface RecommendedAction { id: string; messageId: number; kind: 'goal' | 'plan'; label: string; request: string }
export function useChatActions(readOnly: boolean, latestMessageId: number) {
  const [actions, setActions] = useState<RecommendedAction[]>([])
  useEffect(() => {
    if (readOnly) { setActions([]); return }
    const controller = new AbortController()
    const load = () => {
      const token = getUiToken()
      if (!token) return
      void fetch(`${officeHttpBase()}/chat/actions`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(r => r.ok ? r.json() : null).then(d => { if (d) setActions(d.paused ? [] : d.actions) }).catch(() => {})
    }
    load()
    const timer = setInterval(load, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [readOnly, latestMessageId])
  return actions
}

export default function ChatActions({ actions }: { actions: RecommendedAction[] }) {
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState<string[]>([])
  const [declined, setDeclined] = useState<string[]>([])
  const [error, setError] = useState('')
  /** Approve or decline a step; either is written to the chat by the server */
  async function decide(action: RecommendedAction, decision: 'approve' | 'decline') {
    const token = getUiToken()
    if (!token || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`${officeHttpBase()}/chat/actions/${decision}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: action.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Could not ${decision} this step.`)
      if (decision === 'approve') setAccepted(previous => [...previous, action.id])
      else setDeclined(previous => [...previous, action.id])
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reach Office.') }
    finally { setBusy(false) }
  }
  return <div className="chat-next-actions">
    {actions.map(action => <div key={action.id} className="chat-next-action">
      <strong>{action.kind === 'goal' ? 'Execution approval' : 'Suggested next step'}</strong>
      <p>{action.request}</p>
      {declined.includes(action.id) ? <p className="chat-next-decided">Declined — recorded in the chat.</p> : <>
        <button type="button" disabled={busy || accepted.includes(action.id)} onClick={() => void decide(action, 'approve')}>{accepted.includes(action.id) ? 'Approved — queued' : busy ? 'Working…' : action.label}</button>
        {!accepted.includes(action.id) && <button type="button" className="chat-next-decline" disabled={busy} onClick={() => void decide(action, 'decline')}>Decline</button>}
      </>}
      <small>{action.kind === 'goal' ? 'Runs the plan shown above and may change files.' : 'Starts planning. Execution requires a separate approval.'}</small>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
