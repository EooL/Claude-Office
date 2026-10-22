import React, { useEffect, useState } from 'react'
import { officeHttpBase } from '../serverUrl'
import { getUiToken } from '../permissions'
import ExpandableChatContent from './ExpandableChatContent'

export interface RecommendedAction { id: string; messageId: number; kind: 'goal' | 'plan'; label: string; request: string; decision?: 'started' | 'ignored'; disabled?: boolean }
export const isSuggestion = (action: RecommendedAction) => action.kind === 'plan' && action.id.startsWith('next:')

/** Only an authenticated, actionable suggestion replaces its source line. */
export function ActionMessage({ text, messageId, actions, readOnly = false, onResize }: { text: string; messageId: number; actions: RecommendedAction[]; readOnly?: boolean; onResize?: () => void }) {
  const visible = readOnly ? [] : actions
  const requests = visible.filter(action => isSuggestion(action) && !action.decision && !action.disabled).map(action => action.request)
  const body = text.replace(/^(?:NEXT_ACTION|Suggested next steps?):([^\r\n]*)(?:\r?\n|$)/gim,
    (line, task: string) => requests.includes(task.trim()) ? '' : line).trim()
  return <><ExpandableChatContent text={body} messageId={messageId} readOnly={readOnly} onResize={onResize} /><ChatActions actions={visible} /></>
}
export function useChatActions(readOnly: boolean, latestMessageId: number) {
  const [actions, setActions] = useState<RecommendedAction[]>([])
  useEffect(() => {
    if (readOnly) { setActions([]); return }
    const controller = new AbortController()
    const load = () => {
      const token = getUiToken()
      if (!token) return
      void fetch(`${officeHttpBase()}/chat/actions`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        .then(r => r.ok ? r.json() : null).then(d => {
          if (d) setActions([...(d.actions ?? []).filter((action: RecommendedAction) => !d.paused || isSuggestion(action)).map((action: RecommendedAction) => ({ ...action, disabled: Boolean(d.paused) })), ...(d.decisions ?? [])])
        }).catch(() => {})
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
    {actions.map(action => {
      const decided = isSuggestion(action) && (action.decision || accepted.includes(action.id) || declined.includes(action.id))
      return <div key={action.id} className="chat-next-action">
      {decided ? <p className="chat-next-decided" role="status">{action.decision === 'ignored' || declined.includes(action.id) ? 'Ignored' : 'Started'}</p> : <>
      <strong>{action.kind === 'goal' ? 'Execution approval' : 'Suggested next step'}</strong>
      {isSuggestion(action) ? <blockquote>{action.request}</blockquote> : <p>{action.request}</p>}
      {declined.includes(action.id) ? <p className="chat-next-decided">Declined — recorded in the chat.</p> : <>
        <button type="button" disabled={busy || action.disabled || accepted.includes(action.id)} onClick={() => void decide(action, 'approve')}>{accepted.includes(action.id) ? 'Approved — queued' : busy ? 'Working…' : isSuggestion(action) ? 'Start' : action.label}</button>
        {!accepted.includes(action.id) && <button type="button" className="chat-next-decline" disabled={busy || action.disabled} onClick={() => void decide(action, 'decline')}>{isSuggestion(action) ? 'Ignore' : 'Decline'}</button>}
      </>}
      <small>{action.kind === 'goal' ? 'Runs the plan shown above and may change files.' : 'Starts planning. Execution requires a separate approval.'}</small>
      </>}
    </div>})}
    {error && <p role="alert">{error}</p>}
  </div>
}
