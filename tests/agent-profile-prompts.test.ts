import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as profiles from '../server/agent-profiles.mjs'
import { chatReplyPrompt, FOLLOW_UP_INSTRUCTION, goalPrompt, jobDescription, planPrompt } from '../server/delegation.mjs'

// never the real office home: the building registry is read from a disposable root
let root: string
const originalEnv = { root: process.env.AGENT_OFFICE_ROOT, home: process.env.AGENT_OFFICE_HOME }
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'profile-prompts-'))
  process.env.AGENT_OFFICE_ROOT = join(root, 'building')
  process.env.AGENT_OFFICE_HOME = join(root, 'home')
})
afterAll(() => {
  for (const [key, value] of [['AGENT_OFFICE_ROOT', originalEnv.root], ['AGENT_OFFICE_HOME', originalEnv.home]]) {
    if (value === undefined) delete process.env[key!]
    else process.env[key!] = value
  }
  rmSync(root, { recursive: true, force: true })
})

const cwd = 'C:\\proj'
const OLD = (name: string, role: string) => `You are ${name}, the office ${role}, working in the project at ${cwd}.`
const jobLayer = (prompt: string) => prompt.split('=== YOUR JOB DESCRIPTION ===\n')[1].split('\n\n=== THE TASK ===\n')[0]
const taskLayer = (prompt: string) => prompt.split('=== THE TASK ===\n')[1]

it('planPrompt and goalPrompt carry the job description and the rest of the old text verbatim', () => {
  const plan = planPrompt({ name: 'Dee', role: 'debugger', task: 'fix it', cwd })
  expect(plan).toContain('Never commit, push, tag or deploy')
  expect(plan).toContain('# What you must not do')
  expect(plan).toContain('Project folder: C:\\proj')
  expect(plan).not.toContain(OLD('Dee', 'debugger'))
  expect(plan.endsWith(['The boss asked: "fix it"', 'Look at the code as needed, but change nothing. Then answer with:', '- a plan of 3 to 6 short bullet points, one line each,', '- then a last line starting with "GOAL:" that states the whole job in one sentence.', 'Be concise. No preamble.'].join('\n'))).toBe(true)
  const goal = goalPrompt({ name: 'Dee', role: 'debugger', goal: 'g', plan: 'p', cwd })
  expect(goal).toContain('Never commit, push, tag or deploy')
  expect(goal.endsWith(['The boss approved this plan.', 'Goal: g', 'Plan:', 'p', 'Do the work now. Keep the changes minimal, and run the project\'s tests if you changed code.', 'When you are finished, reply with a summary of at most 3 lines: what you changed and anything left to check.', FOLLOW_UP_INSTRUCTION].join('\n'))).toBe(true)
  expect(jobLayer(plan).length).toBeLessThan(8000)
})

it('goalPrompt keeps the boss\'s original request when the goal or plan summarises it, and only then', () => {
  const request = 'Read server/a.mjs and scripts/b.mjs and list the top 3 risks with file and line.'
  const withRequest = goalPrompt({ name: 'Dee', role: 'debugger', goal: 'Review three files', plan: '- read the files', cwd, request })
  const task = taskLayer(withRequest)
  expect(task.indexOf(request)).toBeGreaterThan(-1)
  expect(task.indexOf(request)).toBeLessThan(task.indexOf('Goal: Review three files'))
  expect(task).toContain('takes precedence over the plan summary')
  // the same text as the goal is not repeated, and no request leaves the prompt exactly as it was
  const same = taskLayer(goalPrompt({ name: 'Dee', role: 'debugger', goal: request, plan: 'p', cwd, request }))
  expect(same.split(request).length - 1).toBe(1)
  expect(taskLayer(goalPrompt({ name: 'Dee', role: 'debugger', goal: 'g', plan: 'p', cwd }))).not.toContain('original request')
  expect(taskLayer(goalPrompt({ name: 'Dee', role: 'debugger', goal: 'g', plan: 'p', cwd, request: '   ' }))).not.toContain('original request')
  // a very long request is capped
  expect(taskLayer(goalPrompt({ name: 'Dee', role: 'debugger', goal: 'g', plan: 'p', cwd, request: 'x'.repeat(9000) })).length).toBeLessThan(8500)
})

it('an unknown or malformed role falls back to the old one-line text', () => {
  for (const role of ['Claude', '../x', 'nobody']) {
    expect(jobLayer(planPrompt({ name: 'N', role, task: 't', cwd }))).toBe(OLD('N', role))
    expect(jobLayer(goalPrompt({ name: 'N', role, goal: 'g', plan: 'p', cwd }))).toBe(OLD('N', role))
  }
  expect(jobDescription('nobody', cwd)).toBeNull()
})

it('the chat reply prompt adds the job description only for a known role', () => {
  const known = chatReplyPrompt('Question?', 'code-reviewer', cwd)
  expect(known).toContain('Never edit files in any mode')
  expect(known.endsWith(`Question?\n\n${FOLLOW_UP_INSTRUCTION}`)).toBe(true)
  for (const role of ['Reviewer', undefined, '']) {
    const prompt = chatReplyPrompt('Question?', role as any, cwd)
    expect(jobLayer(prompt)).toBe('')
    expect(taskLayer(prompt)).toBe(`Question?\n\n${FOLLOW_UP_INSTRUCTION}`)
  }
})

// Verbatim watcher template; keep this aligned with the read-only shell source.
const watcherTemplate = `$persona

You are responding as $agent_name, the office $agent_role. Stay in character.
Respond in English. This is a conversational reply, not an execution channel. Never promise to start, take over, review, change files, or create a PR. Never claim work has finished. Task starts and status are reported by the delegation controller.
This reply is being generated by $reply_service (model: \${reply_model:-its default}). If asked what AI is running or answering, say that; never guess otherwise.

$dev_context

Recent conversation:
$context

Reply to the latest message naturally in at most three short sentences. Continue the conversation — reference previous messages if relevant.`

it.each(['\n', '\r\n'])('replaces only the watcher introduction and preserves every other byte (%j)', (newline) => {
  const source = readFileSync(new URL('../scripts/chat-ai-watcher.sh', import.meta.url), 'utf8')
  expect(source.match(/    prompt="([\s\S]*?)"\r?\n\r?\n    echo/)?.[1].replace(/\r\n/g, '\n')).toBe(watcherTemplate)
  const prompt = watcherTemplate.replace('$agent_name', 'Reviewer').replace('$agent_role', 'code-reviewer').replace(/\n/g, newline)
  const sentence = 'You are responding as Reviewer, the office code-reviewer. Stay in character.'
  const job = jobDescription('code-reviewer', cwd)!
  const result = chatReplyPrompt(prompt, 'code-reviewer', cwd)
  expect(jobLayer(result)).toBe(job)
  expect(taskLayer(result)).toBe(`${prompt.replace(sentence, '')}\n\n${FOLLOW_UP_INSTRUCTION}`)
  expect(result).not.toContain(sentence)
  expect(result.split(job)).toHaveLength(2)
  expect(result).toContain('not an execution channel')
  expect(result).toContain('generated by $reply_service')
})

it('keeps the watcher prompt unchanged when the role is unknown or its profile cannot load', () => {
  expect(taskLayer(chatReplyPrompt(watcherTemplate, 'unknown-role', cwd))).toBe(`${watcherTemplate}\n\n${FOLLOW_UP_INSTRUCTION}`)
  const unavailable = vi.spyOn(profiles, 'loadProfile').mockImplementationOnce(() => { throw new Error('profile missing') })
  try {
    expect(taskLayer(chatReplyPrompt(watcherTemplate, 'code-reviewer', cwd))).toBe(`${watcherTemplate}\n\n${FOLLOW_UP_INSTRUCTION}`)
  } finally {
    unavailable.mockRestore()
  }
})

it('prepends the profile when a line is only similar to the watcher introduction', () => {
  const prompt = 'You are responding as Reviewer, the office code-reviewer. Stay in character. Extra text.'
  const result = chatReplyPrompt(prompt, 'code-reviewer', cwd)
  expect(jobLayer(result)).toBe(jobDescription('code-reviewer', cwd))
  expect(taskLayer(result)).toBe(`${prompt}\n\n${FOLLOW_UP_INSTRUCTION}`)
})
