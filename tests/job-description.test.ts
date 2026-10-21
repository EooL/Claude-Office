import React from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import JobDescription, { type Profile } from '../src/components/JobDescription'
import OrgChart from '../src/components/OrgChart'
import { lineDiff, lineOffset, markdownToBlocks, problemText } from '../src/jobDescription'

const SECTIONS = ['Who you are', 'Mission and responsibilities', 'What you receive and what you hand back', 'What you must not do', 'Ask the boss first when', 'Definition of done']
const body = SECTIONS.map(s => `# ${s}\nText of ${s}.\n- first bullet\n- second bullet`).join('\n')
const text = `---\nname: debugger\n---\n${body}`

function profile(over: Partial<Profile> = {}): Profile {
  return {
    role: 'debugger', text, defaultText: text, source: 'shipped', warnings: [],
    frontmatter: { tools: ['Read', 'Grep'], disallowedTools: ['Write'], model: 'strong', effort: 'high', office: { displayName: 'Debugger', reportsTo: 'code-reviewer', escalatesTo: 'code-reviewer', status: 'draft', access: { chat: 'read', plan: 'read', write: 'edit-after-approval' } } },
    accessChecks: {}, ...over,
  }
}
const render = (readOnly: boolean, initial: object) =>
  renderToString(React.createElement(JobDescription, { roleId: 'debugger', name: 'Debugger', brain: null, readOnly, serviceLabel: s => (s === 'agy' ? 'Antigravity' : s), initial }))

it('diffs lines as added, removed, unchanged', () => {
  expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
    { op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: ' ', text: 'c' }, { op: '+', text: 'd' },
  ])
  expect(lineDiff('x', 'x').every(l => l.op === ' ')).toBe(true)
})

it('turns markdown into blocks: six headings, bullets, raw text', () => {
  const blocks = markdownToBlocks(text)
  expect(blocks.filter(b => b.type === 'h').map(b => b.text)).toEqual(SECTIONS)
  expect(blocks.filter(b => b.type === 'li')).toHaveLength(12)
  expect(markdownToBlocks('hi <script>x</script>\nmore')).toEqual([{ type: 'p', text: 'hi <script>x</script> more' }])
})

it('read-only shows the text and no editing buttons', () => {
  const html = render(true, { profile: profile() })
  expect(html).toContain('Text of Who you are.')
  for (const b of ['Edit job description', 'Save', 'Enrich', 'Reset to default']) expect(html).not.toContain(b)
  expect(html).toContain('Show changes'); expect(html).toContain('/profiles/debugger/claude'); expect(html).toContain('/profiles/debugger/card')
})

it('editable shows the buttons, status chip, tool chips and warnings', () => {
  const html = render(false, { profile: profile({ source: 'override', warnings: ['careful'] }) })
  for (const b of ['Edit job description', 'Enrich draft', 'Reset to default']) expect(html).toContain(b)
  expect(html).toContain('jd-status is-draft'); expect(html).toContain('Grep'); expect(html).toContain('code-reviewer'); expect(html).toContain('careful')
})

it('shows one access summary and hides its details until expanded', () => {
  const accessSummary = { count: 1, text: 'Antigravity cannot guarantee read-only in plan mode.', byService: [{ service: 'agy', label: 'Antigravity', issues: [{ mode: 'plan', wanted: 'read', guaranteed: false }] }] }
  const html = render(false, { profile: profile({ accessSummary }) })
  expect(html).toContain(accessSummary.text); expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('plan: read')
  const expanded = render(false, { profile: profile({ accessSummary }), accessExpanded: true })
  expect(expanded).toContain('aria-expanded="true"'); expect(expanded).toContain('Antigravity'); expect(expanded).toContain('plan: read'); expect(expanded).toContain('cannot be guaranteed')
})

it('hides absent or empty access summaries, including legacy checks from older servers', () => {
  const legacy = { agy: [{ mode: 'plan', wanted: 'read', guaranteed: false, message: 'legacy noise' }] }
  expect(render(false, { profile: profile({ accessChecks: legacy }) })).not.toContain('Details')
  expect(render(false, { profile: profile({ accessSummary: { count: 0, text: '', byService: [] } }) })).not.toContain('jd-access')
})

it('disables both saves while checking or invalid, and enables them only when valid', () => {
  for (const state of [{ checking: true }, { problems: [{ line: 2, message: 'Wrong model' }] }]) {
    const html = render(false, { profile: profile(), draft: text, ...state })
    expect(html.match(/class="backend-primary" disabled=""/g)).toHaveLength(2)
    expect(html).toContain(state.checking ? 'Checking\u2026' : '1 errors')
  }
  const valid = render(false, { profile: profile(), draft: text })
  expect(valid).toContain('>Valid<'); expect(valid).toContain('Save (draft)'); expect(valid).toContain('Save and approve')
  expect(valid).not.toContain('class="backend-primary" disabled')
})

it('renders located errors as cursor buttons and tolerates older errors without a line', () => {
  const html = render(false, { profile: profile(), draft: text, problems: [{ line: 5, field: 'model', message: 'Wrong value' }, { message: 'Older server error' }] })
  expect(html).toContain('line 5: model: Wrong value'); expect(html).toContain('Older server error'); expect(html).toContain('2 errors')
  expect(html).toContain('class="brain-link">line 5:')
})

it('formats errors and resolves line offsets including CRLF, empty and missing lines', () => {
  expect(problemText({ line: 3, message: 'Missing section' })).toBe('line 3: Missing section')
  expect(problemText({ field: 'model', message: 'Invalid' })).toBe('model: Invalid')
  expect(problemText({ message: 'Offline' })).toBe('Offline')
  expect(lineOffset('one\r\ntwo\r\nthree', 2)).toBe(5)
  expect(lineOffset('one\ntwo\nthree', 3)).toBe(8)
  expect(lineOffset('one\ntwo', 20)).toBe(7)
  expect(lineOffset('', 2)).toBe(0)
  expect(lineOffset('one', 0)).toBe(0)
})

const roles = [
  { role: 'architect', name: 'Architect', reportsTo: null },
  { role: 'debugger', name: 'Debugger', reportsTo: 'architect' },
  { role: 'tester', name: 'Tester', reportsTo: 'architect' },
]
const statuses = ['default', 'draft', 'approved']
const profiles = roles.map((r, i) => ({ role: r.role, displayName: r.name, status: statuses[i] }))
const brain = { id: 'deep', name: 'Deep thinker', steps: [] }
const overview: any = {
  brains: [brain], agents: {}, effective: {}, recommended: {}, unconfigured: [],
  operations: { chat: { brain: null, steps: [] }, orchestrator: { brain: null, steps: [] } },
}
const team = (readOnly: boolean, initial?: object) =>
  renderToString(React.createElement(OrgChart, {
    roles, overview, serviceLabel: (s: string) => s, defaultLabel: 'Claude', readOnly, profiles,
    onLink: () => {}, onLinkOperation: () => {}, onEditBrain: () => {}, onAutoAssign: async () => 0, initial,
  } as any))

it('the Team tree shows every node with a status marker and no role sidebar', () => {
  const html = team(false, { selected: 'debugger' })
  for (const n of ['Chat', 'Orchestrator', 'Architect', 'Debugger', 'Tester']) expect(html).toContain(`>${n}<`)
  // a marker only where the job description was changed: draft and approved, never the 13 plain defaults
  for (const s of ['draft', 'approved']) expect(html).toContain(`jd-status is-${s}`)
  expect(html).not.toContain('jd-status is-default')
  expect(html).not.toContain('jd-roles')
})

it('there is no Brain | Job description switch: the CV shows both at once', () => {
  const html = team(false, { selected: 'debugger', job: { profile: profile() } })
  expect(html).not.toContain('role="tablist"'); expect(html).not.toContain('org-segment')
  expect(html).toContain('id="org-brain"'); expect(html).toContain('Text of Who you are.')
  expect(team(true, { selected: 'debugger', job: { profile: profile() } })).not.toContain('Edit job description')
})

it('shows an error state', () => {
  const html = render(false, { error: 'Could not reach the office server.' })
  expect(html).toContain('Could not reach the office server.'); expect(html).toContain('role="alert"')
})

it('renders hostile markup as escaped text', () => {
  const html = render(false, { profile: profile({ text: '# Who you are\n<img src=x onerror=alert(1)>' }) })
  expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  const merged = team(false, { selected: 'debugger', job: { profile: profile({ text: '# Who you are\n<img src=x onerror=alert(1)>' }) } })
  expect(merged).not.toContain('<img src=x'); expect(merged).toContain('&lt;img src=x')
})
