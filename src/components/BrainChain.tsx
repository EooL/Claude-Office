/**
 * BrainChain — the steps of a brain in the order they are tried, each with the service, model and reasoning it
 * uses and, when it is out for now (window used up, no credits, not available), why and until when.
 */

import React from 'react'
import { blockedText, untilText, type BrainStep } from '../brains'

interface Props {
  steps: BrainStep[]
  label: (service: string) => string
  empty?: string
}

export default function BrainChain({ steps, label, empty = 'No model is available for this yet.' }: Props) {
  if (steps.length === 0) return <p className="org-hint">{empty}</p>
  return (
    <ol className="brain-chain" aria-label="Steps, in the order they are tried">
      {steps.map((s, i) => (
        <li key={`${i}-${s.service}-${s.model}`} className={s.blocked ? 'is-blocked' : undefined}>
          <span className="brain-n">{i + 1}</span>
          <span className="brain-chain-text">
            <strong>{label(s.service)}</strong> · {s.label || s.model || 'default model'}{s.effort ? ` · ${s.effort}` : ''}
            {s.blocked && <span className="brain-blocked-inline"> · {blockedText(s.blocked)}, {untilText(s.blocked.until)}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
