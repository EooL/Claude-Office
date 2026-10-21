import React from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import MasterPrompt, { type MasterPromptProfile } from '../src/components/MasterPrompt'
import OrgChart from '../src/components/OrgChart'

const profile: MasterPromptProfile = { text: '# Boundary\nStay inside {{project}}.', defaultText: '# Boundary\nStay here.', source: 'override', status: 'draft', hash: 'abc', warnings: [] }
const render = (initial: React.ComponentProps<typeof MasterPrompt>['initial'] = {}, readOnly = false) => renderToString(React.createElement(MasterPrompt, { readOnly, initial: { profile, ...initial } }))
it('project CV uses the shared frame, project glyph, variables, counts and UTF-8 size', () => {
  const html = render({ profile: { ...profile, text: 'é' } })
  for (const text of ['cv-head is-sticky', 'aria-label="Project"', 'Project rules', 'The rules every agent follows, before its own job description', 'Applies to', 'All 13 agents', 'Chat and Orchestrator (2 operations)', '{{project}}', '{{office}}', '2 bytes of 8 KB', 'jd-status is-draft', 'Edit project rules', 'Show changes', 'Reset to default']) expect(html).toContain(text)
  for (const text of ['Enrich', 'A2A card', 'Claude agent file']) expect(html).not.toContain(text)
})
it('read-only never offers an editor or mutating actions', () => {
  const html = render({}, true)
  expect(html).toContain('Stay inside {{project}}.'); expect(html).toContain('Read-only:')
  for (const text of ['Edit project rules', 'Reset to default', '<textarea', 'Save and approve']) expect(html).not.toContain(text)
})
it('validation warnings do not disable either save action', () => {
  const html = render({ draft: 'New rules', warnings: ['Boundary sentence is missing.'] })
  expect(html).toContain('Boundary sentence is missing.'); expect(html).toContain('>Valid<')
  expect(html).toContain('<button type="button" class="backend-primary">Save (draft)</button>')
  expect(html).toContain('<button type="button" class="backend-primary">Save and approve</button>')
})
it('errors show locations and block both saves; older errors remain readable', () => {
  const html = render({ draft: '', problems: [{ line: 2, message: 'Empty.' }, { message: 'Older server.' }] })
  expect(html).toContain('line 2: Empty.'); expect(html).toContain('Older server.')
  expect(html).toContain('>2 errors<'); expect(html.match(/class="backend-primary" disabled=""/g)).toHaveLength(2)
})
it('checking is visible and blocks both saves', () => {
  const html = render({ draft: 'New rules', checking: true })
  expect(html).toContain('Checking…'); expect(html.match(/class="backend-primary" disabled=""/g)).toHaveLength(2)
})
it('hostile markup in content, warnings and diff stays escaped', () => {
  const html = render({ profile: { ...profile, text: '<script>bad()</script>' }, warnings: ['<img src=x onerror=bad()>'], showDiff: true })
  expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;'); expect(html).toContain('&lt;img src=x onerror=bad()&gt;')
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x')
  expect(html).toContain('Changes against the default')
})
it('the project node is above Boss and selects its CV, marking only non-default status', () => {
  const chart = (status: MasterPromptProfile['status']) => renderToString(React.createElement(OrgChart, {
    roles: Array.from({ length: 13 }, (_, n) => ({ role: `role${n}`, name: `Role ${n}`, reportsTo: null })),
    overview: { brains: [], agents: {}, effective: {}, recommended: {}, unconfigured: [], operations: { chat: { brain: null, steps: [] }, orchestrator: { brain: null, steps: [] } } } as any,
    serviceLabel: s => s, defaultLabel: 'Claude', readOnly: false, onLink: () => {}, onLinkOperation: () => {}, onEditBrain: () => {}, onAutoAssign: async () => 0,
    initial: { selected: 'project-rules', master: { profile: { ...profile, status } } },
  }))
  const html = chart('draft')
  expect(html.indexOf('org-project')).toBeLessThan(html.indexOf('org-boss'))
  expect(html).toContain('org-project is-selected'); expect(html).toContain('All 13 agents')
  expect(html.match(/jd-status is-draft/g)).toHaveLength(2)
  expect(chart('default').match(/jd-status is-default/g)).toHaveLength(1)
})
