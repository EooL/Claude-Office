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
import { TIER_LABEL, type Brain, type BrainsOverview, type Operation } from '../brains'
import BrainChain from './BrainChain'
import ThemedSelect from './ThemedSelect'
import JobDescription, { CvShell, type ProfileSummary } from './JobDescription'
import { getAvatarSrc } from './SlackChat'
import MasterPrompt from './MasterPrompt'
import { officeHttpBase } from '../serverUrl'

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
  /** Job description state of every agent (GET /profiles): the marker on its node */
  profiles?: ProfileSummary[]
  /** A saved, approved or reset job description changed this agent's state */
  onProfileStatus?: (role: string, status: string) => void
  /** Seeds the selection (tests) */
  initial?: { selected?: string; job?: React.ComponentProps<typeof JobDescription>['initial']; master?: React.ComponentProps<typeof MasterPrompt>['initial'] }
}

const OPERATIONS: Record<Operation, { name: string; blurb: string }> = {
  chat: { name: 'Chat', blurb: 'Answers what is typed in the office chat.' },
  orchestrator: { name: 'Orchestrator', blurb: 'Decides whether a message is a job for an agent and starts it. Agents without a brain of their own use its brain.' },
}
const opKey = (op: Operation) => `op:${op}`

/** The recommended brain: one line (name and tier), the reason, Apply and Edit brains behind a toggle. */
export function RecCard({ brain, why, applied, readOnly, onApply, onEdit, defaultOpen = false }: {
  brain: Brain; why: string; applied: boolean; readOnly: boolean; onApply: () => void; onEdit: () => void; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const summary = `Recommended: ${brain.name}${brain.tier ? ` · ${TIER_LABEL[brain.tier]}` : ''}`
  return (
    <div className="org-rec">
      <div className="org-rec-head">
        <strong title={summary}>{summary}</strong>
        <button type="button" className="brain-link org-rec-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button>
      </div>
      {open && (
        <>
          <p className="org-hint">{why}</p>
          <div className="org-rec-actions">
            <button type="button" className="backend-secondary" disabled={readOnly || applied} onClick={onApply}>{applied ? 'Applied' : 'Apply'}</button>
            <button type="button" className="brain-link" onClick={onEdit}>Edit brains</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function OrgChart({ roles, overview, serviceLabel, defaultLabel, readOnly, onLink, onLinkOperation, onEditBrain, onAutoAssign, profiles, onProfileStatus, initial }: Props) {
  const [selected, setSelected] = useState<string>(initial?.selected ?? opKey('orchestrator'))
  const [dirty, setDirty] = useState(false) // the job description editor holds unsaved changes
  const [pending, setPending] = useState<string | null>(null) // a node waiting for the discard answer
  const [done, setDone] = useState<number | null>(null) // how many the last auto-set covered
  const [masterStatus, setMasterStatus] = useState(initial?.master?.profile?.status ?? 'default')
  React.useEffect(() => {
    let current = true
    void fetch(`${officeHttpBase()}/master-prompt`, { signal: AbortSignal.timeout(30000) }).then(r => r.ok ? r.json() : null).then(p => { if (current && p?.status) setMasterStatus(p.status) }).catch(() => {})
    return () => { current = false }
  }, [])
  const unconfigured = overview.unconfigured ?? []
  const operation = (Object.keys(OPERATIONS) as Operation[]).find(op => opKey(op) === selected)
  const current = operation || selected === 'project-rules' ? undefined : roles.find(r => r.role === selected) ?? roles[0]

  /** Move to a node; unsaved editor changes ask first */
  const go = (target: { node: string }, force = false) => {
    if (dirty && !force) { setPending(target.node); return }
    setPending(null); setDirty(false)
    setSelected(target.node)
  }
  const statusOf = (role: string) => profiles?.find(p => p.role === role)?.status

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
          onClick={() => go({ node: r.role })}
          aria-pressed={r.role === current?.role}
        >
          <span className="org-name">{r.name}</span>
          <span className="org-meta">
            <span className={`org-service${overview.agents[r.role] ? '' : ' is-default'}`}>{roleName(r.role)}</span>
            {statusOf(r.role) && statusOf(r.role) !== 'default' && <span className={`jd-status is-${statusOf(r.role)}`} title="Job description">{statusOf(r.role)}</span>}
          </span>
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
        onClick={() => go({ node: opKey(op) })}
        aria-pressed={operation === op}
      >
        <span className="org-name">{OPERATIONS[op].name}</span>
        <span className={`org-service${overview.operations[op].brain ? '' : ' is-default'}`}>{opName(op)}</span>
      </button>
      {children}
    </li>
  )

  // --- the detail of the selected node
  let brainBlock: React.ReactNode = null
  if (operation) {
    const info = overview.operations[operation]
    const rec = overview.recommendedOperations?.[operation] // absent from an older server
    const recBrain = rec && overview.brains.find(b => b.id === rec.id)
    brainBlock = (
      <>
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
          <RecCard brain={recBrain} why={rec.why} applied={info.brain === rec.id} readOnly={readOnly} onApply={() => onLinkOperation(operation, rec.id)} onEdit={() => onEditBrain(recBrain.id)} />
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
    brainBlock = (
      <>
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
          <RecCard brain={recBrain} why={rec.why} applied={own === rec.id} readOnly={readOnly} onApply={() => onLink(current.role, rec.id)} onEdit={() => onEditBrain(recBrain.id)} />
        )}
        <p className="org-hint">Used for the jobs the chat hands {current.name}.</p>
      </>
    )
  }

  const nameOf = (role: string) => roles.find(r => r.role === role)?.name ?? role
  const person = (r: ChartRole) => ({ role: r.role, name: r.name })
  const parentOf = current ? roles.find(r => r.role === current.reportsTo) : undefined

  return (
    <div className="org-chart">
     <div className="org-split">
      <div className="org-left">
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
          <button type="button" className={`org-node org-project${selected === 'project-rules' ? ' is-selected' : ''}`} aria-pressed={selected === 'project-rules'} onClick={() => go({ node: 'project-rules' })}>
            <span className="org-name"><span aria-hidden="true">▣</span> Project rules</span>
            {masterStatus !== 'default' && <span className={`jd-status is-${masterStatus}`}>{masterStatus}</span>}
          </button>
          <ul className="org-branch"><li>
          <div className="org-node org-boss" aria-hidden="true"><span className="org-name">Boss</span><span className="org-service is-default">you</span></div>
          <ul className="org-branch">
            {renderOperation('chat')}
            {renderOperation('orchestrator', <ul className="org-branch">{roles.filter(r => r.reportsTo === null).map(renderRole)}</ul>)}
          </ul>
          </li></ul>
        </li>
      </ul>
      </div>
      <div className="org-right">
        {pending && (
          <p className="jd-confirm" role="alert">Discard your unsaved changes?{' '}
            <button type="button" className="backend-secondary" onClick={() => go({ node: pending }, true)}>Discard</button>{' '}
            <button type="button" className="brain-link" onClick={() => setPending(null)}>Keep editing</button></p>
        )}
        {selected === 'project-rules' ? <MasterPrompt readOnly={readOnly} agentCount={roles.length} onDirtyChange={setDirty} onStatusChange={setMasterStatus} initial={initial?.master} /> : current ? (
          <JobDescription
            roleId={current.role} name={current.name} readOnly={readOnly} serviceLabel={serviceLabel} brain={brainBlock}
            reportsTo={parentOf ? person(parentOf) : null} manages={roles.filter(k => k.reportsTo === current.role).map(person)}
            onSelect={role => go({ node: role })} nameOf={nameOf}
            onDirtyChange={setDirty} onStatusChange={onProfileStatus} initial={initial?.job}
          />
        ) : operation && (
          <CvShell
            portrait={getAvatarSrc(operation === 'chat' ? 'assistant' : 'general-purpose')} name={OPERATIONS[operation].name} headline={OPERATIONS[operation].blurb}
            sidebar={<section className="cv-block"><h4>Brain</h4>{brainBlock}</section>}
            main={<p className="org-hint">{`The ${OPERATIONS[operation].name.toLowerCase()} is not an agent and has no job description; its brain is chosen on the left.`}</p>}
          />
        )}
      </div>
     </div>
    </div>
  )
}
