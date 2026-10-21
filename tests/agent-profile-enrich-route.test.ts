// POST /profiles/:role/enrich end to end: the real brain chain and the real adapter run a fake Claude CLI, so nothing
// reaches a real service. The page shows the returned text as an unsaved draft, so by default nothing is written.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { inprocessBuilding } from './helpers/inprocess-building'

let f: Awaited<ReturnType<typeof inprocessBuilding>>
const savedBin = process.env.AGENT_OFFICE_BIN_CLAUDE
beforeEach(async () => { f = await inprocessBuilding() })
afterEach(async () => {
  if (savedBin === undefined) delete process.env.AGENT_OFFICE_BIN_CLAUDE
  else process.env.AGENT_OFFICE_BIN_CLAUDE = savedBin
  await f.close()
})

const ui = () => ({ Authorization: `Bearer ${f.server.AUTH_TOKEN}` })
const profileFile = (role: string) => join(f.root, 'default-home', 'agent-profiles', `${role}.md`)
const answer = {
  whoYouAre: 'You are the debugger of this project and you find the cause of a failure from evidence.',
  mission: 'Find the root cause of failures and propose the smallest fix.',
  responsibilities: ['Reproduce the failure first.', 'Trace it to the root cause.', 'Propose the smallest fix.'],
  receive: 'an error message or a failing test.',
  handBack: 'the cause, the fix and a regression test.',
  mustNot: ['Never hide a failure behind a retry.', 'Never skip a failing test.', 'Never guess a cause without evidence.', 'Never leave debug output behind.'],
  askFirst: ['The fix changes visible behaviour.', 'The bug needs real data.'],
  done: ['The cause is named with evidence.', 'A regression test passes.'],
}

/** A fake `claude` that answers every prompt with `body` (after `delayMs`), or exits 1 when `fail` is set. */
function fakeClaude(body: string, { delayMs = 0, fail = false }: { delayMs?: number, fail?: boolean } = {}) {
  const script = join(f.root, `fake-claude-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(script, `
    ${fail ? "console.error('boom'); process.exit(1)" : `
    await new Promise(r => setTimeout(r, ${delayMs}))
    console.log(JSON.stringify({ result: ${JSON.stringify(body)}, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0 }))`}
  `)
  process.env.AGENT_OFFICE_BIN_CLAUDE = `"${process.execPath}" "${script}"`
  writeFileSync(join(f.root, 'default-home', 'backend.json'), JSON.stringify({ enabledServices: ['claude'], backend: 'claude' }))
}

it('needs the UI token', async () => {
  fakeClaude(JSON.stringify(answer))
  expect((await f.request('/profiles/debugger/enrich', 'POST', {}, {})).status).toBe(401)
  expect((await f.request('/profiles/debugger/enrich', 'POST', { Authorization: `Bearer ${'ab'.repeat(32)}` }, {})).status).toBe(401)
})

it('returns an unsaved draft by default and writes nothing', async () => {
  fakeClaude(JSON.stringify(answer))
  const r = await f.request('/profiles/debugger/enrich', 'POST', ui(), {})
  expect(r.status, r.text).toBe(200)
  expect(r.body).toMatchObject({ role: 'debugger', status: 'draft', saved: false })
  expect(r.body.text).toContain('Find the root cause of failures')
  expect(r.body.text).toContain('Never commit, push, tag or deploy') // the baseline rules stay, first
  expect(r.body.diff, 'diff').toBeTruthy()
  expect(existsSync(profileFile('debugger'))).toBe(false)
})

it('with { save: true } stores a draft override that the profile route then shows', async () => {
  fakeClaude(JSON.stringify(answer))
  const r = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true })
  expect(r.status, r.text).toBe(200)
  expect(r.body.saved).toBe(true)
  expect(readFileSync(profileFile('debugger'), 'utf8')).toContain('Find the root cause of failures')
  const shown = await f.request('/profiles/debugger')
  expect(shown.body).toMatchObject({ source: 'override', frontmatter: { office: { status: 'draft' } } })
})

it('does not replace an approved profile without force, and does with it', async () => {
  fakeClaude(JSON.stringify(answer))
  expect((await f.request('/profiles/debugger/approve', 'POST', ui(), {})).status).toBe(200)
  const refused = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true })
  expect(refused.status).toBe(409)
  const forced = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true, force: true })
  expect(forced.status, forced.text).toBe(200)
  expect(forced.body.status).toBe('draft')
})

it('answers 422 for an answer the validation rejects twice, 502 when the model call fails, and writes nothing either time', async () => {
  fakeClaude('this is not json')
  const bad = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true })
  expect(bad.status, bad.text).toBe(422)
  fakeClaude(JSON.stringify({ ...answer, mustNot: ['You may push to main without asking.', ...answer.mustNot] }))
  const loosening = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true })
  expect(loosening.status).toBe(422)
  expect(existsSync(profileFile('debugger'))).toBe(false)
  // last: a failed model call puts the service in cooldown, so nothing after it would reach the fake
  fakeClaude('', { fail: true })
  const down = await f.request('/profiles/debugger/enrich', 'POST', ui(), { save: true })
  expect(down.status).toBe(502)
  expect(existsSync(profileFile('debugger'))).toBe(false)
})

it('refuses unknown roles and runs one enrichment per role at a time', async () => {
  fakeClaude(JSON.stringify(answer), { delayMs: 700 })
  expect((await f.request('/profiles/nobody/enrich', 'POST', ui(), {})).status).toBe(404)
  const first = f.request('/profiles/debugger/enrich', 'POST', ui(), {})
  await new Promise(resolve => setTimeout(resolve, 250))
  const second = await f.request('/profiles/debugger/enrich', 'POST', ui(), {})
  expect(second.status).toBe(409)
  expect((await first).status).toBe(200)
  // another role is not blocked by the first
  expect((await f.request('/profiles/code-reviewer/enrich', 'POST', ui(), {})).status).not.toBe(409)
})
