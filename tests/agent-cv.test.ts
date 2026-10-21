import React from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import OrgChart, { RecCard } from '../src/components/OrgChart'
import type { Profile } from '../src/components/JobDescription'

const SECTIONS = ['Who you are', 'Mission and responsibilities', 'What you receive and what you hand back', 'What you must not do', 'Ask the boss first when', 'Definition of done']
const text = `---\nname: debugger\n---\n${SECTIONS.map(s => `# ${s}\nText of ${s}.`).join('\n')}`
const profile = (over: Partial<Profile> = {}): Profile => ({
  role: 'debugger', text, defaultText: text, source: 'override', warnings: [],
  frontmatter: { description: 'Finds the root cause of a bug.', tools: ['Read', 'Grep'], disallowedTools: ['Write'], model: 'strong', effort: 'high', office: { displayName: 'Debugger', reportsTo: 'architect', escalatesTo: 'architect', status: 'draft', access: { chat: 'read' } } },
  ...over,
})
const roles = [
  { role: 'architect', name: 'Architect', reportsTo: null },
  { role: 'debugger', name: 'Debugger', reportsTo: 'architect' },
  { role: 'tester', name: 'Tester', reportsTo: 'debugger' },
]
const overview: any = {
  brains: [{ id: 'deep', name: 'Deep thinker', steps: [] }], agents: {}, effective: {}, recommended: {}, unconfigured: [],
  operations: { chat: { brain: null, steps: [] }, orchestrator: { brain: null, steps: [] } },
}
const cv = (readOnly: boolean, selected: string, job?: object) =>
  renderToString(React.createElement(OrgChart, {
    roles, overview, serviceLabel: (s: string) => s, defaultLabel: 'Claude', readOnly,
    onLink: () => {}, onLinkOperation: () => {}, onEditBrain: () => {}, onAutoAssign: async () => 0, initial: { selected, job },
  } as any))

it('an agent CV shows portrait, name, status, relations, sidebar blocks and all six sections at once', () => {
  const html = cv(false, 'debugger', { profile: profile() })
  expect(html).toMatch(/<img class="cv-portrait" src="[^"]+\.png"[^>]*alt="Debugger"/)
  expect(html).toContain('Finds the root cause of a bug.')
  expect(html).toContain('jd-status is-draft')
  expect(html).toMatch(/Reports to:<\/span> <button type="button" class="brain-link cv-person">Architect<\/button>/)
  expect(html).toContain('>Tester</button>'); expect(html).toContain('Manages:'); expect(html).toContain('Escalates to:')
  // one meta row, sticky header, headline clamped with the full text in title, source in the chip's tooltip
  expect(html.match(/class="cv-meta"/g)).toHaveLength(1)
  expect(html).toContain('cv-head is-sticky'); expect(html).toContain('width="56"')
  expect(html).toContain('<p class="cv-headline" title="Finds the root cause of a bug.">')
  expect(html).toContain('title="Job description: draft (source: override)"')
  expect(html.indexOf('cv-actions')).toBeLessThan(html.indexOf('</header>'))
  for (const block of ['Brain', 'Access', 'Tools', 'Model']) expect(html).toContain(`<h4>${block}</h4>`)
  for (const s of SECTIONS) { expect(html).toContain(`<h4>${s}</h4>`); expect(html).toContain(`Text of ${s}.`) }
  expect(html).toContain('cv-section is-must-not"><h4>What you must not do')
  expect(html).not.toContain('role="tablist"')
  for (const b of ['Edit job description', 'Show changes', 'Enrich draft', 'Claude agent file', 'A2A card', 'Reset to default']) expect(html).toContain(b)
})

it('read-only keeps all the content but no editing buttons', () => {
  const html = cv(true, 'debugger', { profile: profile() })
  for (const b of ['Edit job description', 'Enrich', 'Reset to default', 'Save']) expect(html).not.toContain(b)
  for (const s of SECTIONS) expect(html).toContain(`Text of ${s}.`)
  expect(html).toContain('<h4>Tools</h4>'); expect(html).toContain('Show changes')
})

it('Chat and Orchestrator show the Brain block and a note, no sections or actions', () => {
  for (const [selected, name] of [['op:chat', 'Chat'], ['op:orchestrator', 'Orchestrator']]) {
    const html = cv(false, selected)
    expect(html).toContain('<h4>Brain</h4>'); expect(html).toContain('id="org-brain"'); expect(html).toContain(`alt="${name}"`)
    expect(html).toContain(`The ${name.toLowerCase()} is not an agent and has no job description; its brain is chosen on the left.`)
    expect(html).not.toContain('cv-section'); expect(html).not.toContain('Edit job description'); expect(html).not.toContain('<h4>Access</h4>')
  }
})

it('edit mode replaces only the main column', () => {
  const html = cv(false, 'debugger', { profile: profile(), draft: text })
  expect(html).toContain('id="jd-text"'); expect(html).toContain('Save and approve'); expect(html).toContain('Cancel')
  expect(html).not.toContain('cv-section')
  expect(html).toContain('cv-portrait'); expect(html).toContain('<h4>Brain</h4>'); expect(html).toContain('<h4>Tools</h4>')
})

it('the Recommended card is one line until toggled, and the validation status sits in the sticky header', () => {
  const rec = (defaultOpen?: boolean) => renderToString(React.createElement(RecCard, { brain: { id: 'deep', name: 'Deep thinker', builtin: true, tier: 'strong', steps: [] }, why: 'Needs depth.', applied: false, readOnly: false, onApply: () => {}, onEdit: () => {}, defaultOpen }))
  const closed = rec()
  expect(closed).toContain('Recommended: Deep thinker · Strong'); expect(closed).toContain('aria-expanded="false"')
  for (const s of ['Needs depth.', 'Apply', 'Edit brains']) expect(closed).not.toContain(s)
  const open = rec(true)
  expect(open).toContain('aria-expanded="true"'); for (const s of ['Needs depth.', 'Apply', 'Edit brains']) expect(open).toContain(s)
  const html = cv(false, 'debugger', { profile: profile(), draft: text })
  expect(html.indexOf('>Valid<')).toBeLessThan(html.indexOf('</header>'))
})

it('hostile markup in the profile stays escaped', () => {
  const html = cv(false, 'debugger', { profile: profile({ text: '# Who you are\n<script>alert(1)</script>', frontmatter: { description: '<b>x</b>' } }) })
  expect(html).not.toContain('<script>alert'); expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<b>x</b>'); expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
})
