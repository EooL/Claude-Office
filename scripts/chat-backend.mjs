#!/usr/bin/env node
// chat-backend.mjs <adapter> "<prompt>" [--json] — one read-only reply, for the chat watcher. Prints the reply
// text; with --json prints the whole result (text, model, usage, reported, code, durationMs, step, attempts).
//
// With CHAT_AI_ROLE (the office role speaking, for its name in the notices) the reply runs on the chat brain
// (server/brains.mjs, Settings > General): a chain of services and models, moving on to the next when one is used
// up or unavailable. Without it (or with CHAT_AI_BACKEND pinning one service for everybody) it is a single run of
// <adapter>.
// Model from CHAT_AI_MODEL (else the adapter's default), limit from CHAT_AI_TIMEOUT.
import { adapterNames, adapters, runAdapter } from '../server/adapters.mjs'
import { runForOperation } from './brain-run.mjs'
import { reportUsage } from './report-usage.mjs'
import { chatReplyPrompt, guardChatReply } from '../server/delegation.mjs'
import { readJson } from '../server/jsonfile.mjs'
import { officeHome } from '../server/paths.mjs'
import { join } from 'node:path'

const [name, prompt, flag] = process.argv.slice(2)
if (!adapterNames.includes(name) || !prompt) {
  console.error(`usage: chat-backend.mjs <${adapterNames.join('|')}> "<prompt>" [--json]`)
  process.exit(2)
}
const timeoutMs = Number(process.env.CHAT_AI_TIMEOUT ?? 60) * 1000
const role = process.env.CHAT_AI_ROLE

let result
const replyPrompt = chatReplyPrompt(prompt, role, process.cwd())
if (role && !process.env.CHAT_AI_BACKEND) {
  result = await runForOperation('chat', replyPrompt, { timeoutMs }, { role })
} else {
  result = await runAdapter(name, replyPrompt, {
    model: process.env.CHAT_AI_MODEL || undefined,
    timeoutMs: Math.max(timeoutMs, adapters[name].timeoutMs ?? 0),
  })
  await reportUsage(name, result)
}
// no answer: the watcher logs this line, so the reason (not logged in, a limit, ...) is not lost
if (role && result.text) result.text = guardChatReply(result.text, readJson(join(officeHome(process.env.OFFICE_ID ?? 'default'), 'delegation.json'), {}))
if (!result.text && result.error) console.error(result.error)
process.stdout.write(flag === '--json' ? JSON.stringify(result) : result.text)
process.exit(result.text ? 0 : result.code || 1)
