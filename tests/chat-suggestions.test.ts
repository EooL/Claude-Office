import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionMessage, type RecommendedAction } from '../src/components/ChatActions'

const suggestion: RecommendedAction = { id: 'next:7', messageId: 7, kind: 'plan', label: 'Plan recommended step', request: 'Inspect the failing test.' }
const render = (actions: RecommendedAction[], readOnly = false, text = 'Review complete.\nNEXT_ACTION: Inspect the failing test.\n<!-- GOAL_COMPLETE -->') =>
  renderToString(React.createElement(ActionMessage, { text, messageId: 7, actions, readOnly }))

describe('inline chat suggestions', () => {
  it('shows a quote and Start / Ignore below the body, with no raw marker or HTML comments', () => {
    const html = render([suggestion])
    expect(html).toContain('<blockquote>Inspect the failing test.</blockquote>')
    expect(html).toContain('>Start</button>')
    expect(html).toContain('>Ignore</button>')
    expect(html.indexOf('Review complete.')).toBeLessThan(html.indexOf('<blockquote>'))
    expect(html).not.toContain('NEXT_ACTION:')
    expect(html).not.toContain('GOAL_COMPLETE')
    expect(html).toContain('Execution requires a separate approval.')
  })
  it.each(['started', 'ignored'] as const)('renders persisted %s without decision buttons', decision => {
    const html = render([{ ...suggestion, decision }])
    expect(html).toContain(decision === 'started' ? '>Started</p>' : '>Ignored</p>')
    expect(html).not.toContain('>Start</button>')
    expect(html).not.toContain('>Ignore</button>')
  })
  it('preserves the source suggestion for read-only, superseded and paused messages', () => {
    for (const html of [render([suggestion], true), render([]), render([{ ...suggestion, disabled: true }])]) {
      expect(html).toContain('NEXT_ACTION:')
      expect(html).not.toContain('GOAL_COMPLETE')
    }
    expect(render([suggestion], true)).not.toContain('>Start</button>')
    expect(render([{ ...suggestion, disabled: true }])).toContain('disabled=""')
  })
  it('hides both spellings only for an actionable suggestion, and escapes hostile markup', () => {
    const text = 'Hello\nSuggested next steps: <img src=x onerror=alert(1)>\nNEXT_ACTION: <img src=x onerror=alert(1)>'
    const html = render([{ ...suggestion, request: '<img src=x onerror=alert(1)>' }], false, text)
    expect(html).not.toContain('Suggested next steps:')
    expect(html).not.toContain('NEXT_ACTION:')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
    expect(render([], false, text)).toContain('Suggested next steps:')
  })
  it('preserves execution and pending-plan approval labels and source text', () => {
    for (const action of [
      { ...suggestion, id: 'plan:7:hash:0', kind: 'goal' as const, label: 'Approve and execute plan' },
      { ...suggestion, id: 'pending:7', label: 'Approve planning' },
    ]) {
      const html = render([action])
      expect(html).toContain(`>${action.label}</button>`)
      expect(html).toContain('>Decline</button>')
      expect(html).toContain('NEXT_ACTION:')
      expect(html).not.toContain('>Start</button>')
    }
  })
  it('does not hide a different prose proposal when the explicit marker won selection', () => {
    const html = render([suggestion], false, 'Suggested next step: Keep this other proposal visible.\nNEXT_ACTION: Inspect the failing test.')
    expect(html).toContain('Suggested next step: Keep this other proposal visible.')
    expect(html).not.toContain('NEXT_ACTION:')
  })
})
