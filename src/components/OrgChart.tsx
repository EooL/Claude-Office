/**
 * OrgChart — who thinks with what, as the office's chain of command (the Team tab of Settings):
 *
 *   Boss
 *   ├─ Chat           answers what is typed in the office chat
 *   └─ Orchestrator   decides whether a message is a job for an agent and starts it
 *        └─ the agents (Reviewer ─ Debugger, Tester, Security; Architect ─ Frontend, DBA, ...)
 *
 * Click a node to choose its brain (the chain of models it runs on, with a fallback to the next step when one is
 * used up or unavailable; the Brains tab edits them). An agent without a brain of its own inherits the one of the
 * agent above it (Frontend from Architect), and at the top the orchestrator's, which is why the agents hang under
 * it; what is inherited is dimmed. Every node has a recommended brain, with the reason, and one button gives every
 * agent that has no brain the one that suits its work.
 */

import React, { useState } from 'react'
import type { BrainsOverview, Operation } from '../brains'
import BrainChain from './BrainChain'
import ThemedSelect from './ThemedSelect'

export interface ChartRole {
  role: string
  name: string
  reportsTo: string | null
}

interface Props {
  roles: ChartRole[]
  overview: BrainsOverview
  serviceLabel: (service: string) => string
  /** The label of the default AI service, which an operation without a brain runs on */
  defaultLabel: string
  readOnly: boolean
  onLink: (role: string, brain: string | null) => void
  onLinkOperation: (operation: Operation, brain: string | null) => void
  onEditBrain: (brainId: string) => void
  /** Give every agent without a brain the one that suits it; resolves how many were set */
  onAutoAssign: () => Promise<number>
}

const OPERATIONS: Record<Operation, { name: string; blurb: string }> = {
  chat: { name: 'Chat', blurb: 'Answers what is typed in the office chat.' },
  orchestrator: { name: 'Orchestrator', blurb: 'Decides whether a message is a job for an agent and starts it. Agents without a brain of their own use its brain.' },
}
const opKey = (op: Operation) => `op:${op}`

export default function OrgChart({ roles, overview, serviceLabel, defaultLabel, readOnly, onLink, onLinkOperation, onEditBrain, onAutoAssign }: Props) {
  const [selected, setSelected] = useState<string>(opKey('orchestrator'))
  const [done, setDone] = useState<number | null>(null) // how many the last auto-set covered
  const unconfigured = overview.unconfigured ?? []
  const operation = (Object.keys(OPERATIONS) as Operation[]).find(op => opKey(op) === selected)
  const current = operation ? undefined : roles.find(r => r.role === selected) ?? roles[0]

  const brainName = (id: string) => overview.brains.find(b => b.id === id)?.name ?? id
  /** An operation's brain as a name: the one chosen for it, else the default service */
  const opName = (op: Operation) => (overview.operations[op].brain ? brainName(overview.operations[op].brain as string) : defaultLabel)
  /** A role's brain as a name: its own or inherited brain, else the orchestrator's */
  const roleName = (role: string) => {
    const e = overview.effective[role]
    return e ? brainName(e.id) : opName('orchestrator')
  }

  const renderRole = (r: ChartRole): React.ReactNode => {
    const kids = roles.filter(k => k.reportsTo === r.role)
    return (
      <li key={r.role}>
        <button
          type="button"
          className={`org-node${r.role === current?.role ? ' is-selected' : ''}`}
          onClick={() => setSelected(r.role)}
          aria-pressed={r.role === current?.role}
        >
          <span className="org-name">{r.name}</span>
          <span className={`org-service${overview.agents[r.role] ? '' : ' is-default'}`}>{roleName(r.role)}</span>
        </button>
        {kids.length > 0 && <ul className="org-branch">{kids.map(renderRole)}</ul>}
      </li>
    )
  }

  const renderOperation = (op: Operation, children?: React.ReactNode): React.ReactNode => (
    <li key={op}>
      <button
        type="button"
        className={`org-node org-op${operation === op ? ' is-selected' : ''}`}
        onClick={() => setSelected(opKey(op))}
        aria-pressed={operation === op}
      >
        <span className="org-name">{OPERATIONS[op].name}</span>
        <span className={`org-service${overview.operations[op].brain ? '' : ' is-default'}`}>{opName(op)}</span>
      </button>
      {children}
    </li>
  )

  // --- the detail of the selected node
  let detail: React.ReactNode = null
  if (operation) {
    const info = overview.operations[operation]
    const rec = overview.recommendedOperations?.[operation] // absent from an older server
    const recBrain = rec && overview.brains.find(b => b.id === rec.id)
    detail = (
      <>
        <h4 className="org-detail-title">{OPERATIONS[operation].name}</h4>
        <p className="org-hint">{OPERATIONS[operation].blurb}</p>
        <div className="org-field">
          <label htmlFor="org-brain">Brain</label>
          <ThemedSelect
            id="org-brain"
            value={info.brain ?? ''}
            disabled={readOnly}
            onChange={v => onLinkOperation(operation, v || null)}
            options={[{ value: '', label: `Default service (${defaultLabel})` }, ...overview.brains.map(b => ({ value: b.id, label: b.name }))]}
          />
        </div>
        <BrainChain steps={info.steps} label={serviceLabel} empty="No AI service is enabled: turn one on in Services." />
        {rec && recBrain && (
          <div className="org-rec">
            <div className="org-rec-head"><strong>Recommended for {OPERATIONS[operation].name}</strong><span className="org-rec-pick">{recBrain.name}</span></div>
            <p className="org-hint">{rec.why}</p>
            <div className="org-rec-actions">
              <button type="button" className="backend-secondary" disabled={readOnly || info.brain === rec.id} onClick={() => onLinkOperation(operation, rec.id)}>{info.brain === rec.id ? 'Applied' : 'Apply'}</button>
              <button type="button" className="brain-link" onClick={() => onEditBrain(recBrain.id)}>Edit brains</button>
            </div>
          </div>
        )}
      </>
    )
  } else if (current) {
    const own = overview.agents[current.role] ?? ''
    const effective = overview.effective[current.role]
    const parent = roles.find(r => r.role === current.reportsTo)
    const inheritedFrom = parent ? parent.name : 'the orchestrator'
    const brain = overview.brains.find(b => b.id === (effective?.id ?? ''))
    // with no brain at all the agent works on the orchestrator's chain
    const steps = brain ? brain.steps : overview.operations.orchestrator.steps
    const rec = overview.recommended[current.role]
    const recBrain = rec && overview.brains.find(b => b.id === rec.id)
    detail = (
      <>
        <h4 className="org-detail-title">{current.name} <span className="org-role">{current.role}</span></h4>
        <div className="org-field">
          <label htmlFor="org-brain">Brain</label>
          <ThemedSelect
            id="org-brain"
            value={own}
            disabled={readOnly}
            onChange={v => onLink(current.role, v || null)}
            options={[
              { value: '', label: `Same as ${inheritedFrom} (${parent ? roleName(parent.role) : opName('orchestrator')})` },
              ...overview.brains.map(b => ({ value: b.id, label: b.name })),
            ]}
          />
        </div>
        <BrainChain steps={steps} label={serviceLabel} empty="No AI service is enabled: turn one on in Services." />
        {rec && recBrain && (
          <div className="org-rec">
            <div className="org-rec-head"><strong>Recommended for {current.name}</strong><span className="org-rec-pick">{recBrain.name}</span></div>
            <p className="org-hint">{rec.why}</p>
            <div className="org-rec-actions">
              <button type="button" className="backend-secondary" disabled={readOnly || own === rec.id} onClick={() => onLink(current.role, rec.id)}>{own === rec.id ? 'Applied' : 'Apply'}</button>
              <button type="button" className="brain-link" onClick={() => onEditBrain(recBrain.id)}>Edit brains</button>
            </div>
          </div>
        )}
        <p className="org-hint">Used for the jobs the chat hands {current.name}.</p>
      </>
    )
  }

  return (
    <div className="org-chart">
      <div className="org-auto">
        {unconfigured.length > 0 ? (
          <button
            type="button"
            className="backend-secondary"
            disabled={readOnly}
            title="Gives each the built-in brain that suits its work, for example Debugger the Deep thinker. Agents that already have a brain, their own or inherited, are left as they are."
            onClick={() => void onAutoAssign().then(setDone)}
          >Auto-set brain for {unconfigured.length} unconfigured {unconfigured.length === 1 ? 'agent' : 'agents'}</button>
        ) : (
          <span className="org-hint">Every agent has a brain{done ? ` (${done} just set)` : ''}.</span>
        )}
      </div>
      <ul className="org-tree" aria-label="Office team">
        <li>
          <div className="org-node org-boss" aria-hidden="true"><span className="org-name">Boss</span><span className="org-service is-default">you</span></div>
          <ul className="org-branch">
            {renderOperation('chat')}
            {renderOperation('orchestrator', <ul className="org-branch">{roles.filter(r => r.reportsTo === null).map(renderRole)}</ul>)}
          </ul>
        </li>
      </ul>
      <div className="org-detail">{detail}</div>
    </div>
  )
}
