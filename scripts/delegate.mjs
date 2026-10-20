#!/usr/bin/env node
// delegate.mjs — the chat watcher's hook into the delegation flow (server/delegation.mjs).
//
//   delegate.mjs message "<text>"   prints 'chat' (the watcher answers) or 'handled' (this did)
//   delegate.mjs goal "<text>"      the boss said /goal: do the latest plan, in the background
//   delegate.mjs plan <base64 json> / goal-run "<text>"   the background halves of the two above
//
// Agents show up in the office through the same events the Claude Code hooks send (agent_spawned,
// agent_working, agent_completed), speak through POST /chat/reply, and every run reports its usage
// to the PAYROLL / ELECTRICITY meters like the chat replies do.
import { fork } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { delegationStatus, handleGoal, handleMessage, startPlan } from '../server/delegation.mjs'
import { acquireProcessLock } from '../server/process-lock.mjs'
import { resolveSteps } from '../server/brains.mjs'
import { readJson, writeJson } from '../server/jsonfile.mjs'
import { homeDir } from '../server/settings.mjs'
import { runForOperation, runForRole } from './brain-run.mjs'
import { office, say } from './office-client.mjs'

const here = fileURLToPath(import.meta.url)
const stateFile = join(homeDir, 'delegation.json')
const deps = {
  pid: process.pid,
  now: () => Date.now(),
  cwd: process.cwd(),
  read: () => {
    return readJson(stateFile, {})
  },
  write(patch) {
    const next = { ...deps.read(), ...patch }
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    writeJson(stateFile, next)
  },
  agent: (role) => resolveSteps(role)[0],
  // the agent speaks for itself when every step of its brain is out: delegation reports the failure its own way
  run: (role, prompt, { operation, ...opts }) => {
    const options = { ...opts, onAttempt: async step => {
      if (operation) return
      const busy = deps.read().busy
      if (!busy) return
      deps.write({ busy: { ...busy, service: step.service, model: step.model } })
      await deps.working(busy.id, `${busy.kind === 'plan' ? 'planning' : 'executing'} via ${step.service}`)
    } }
    return operation
      ? runForOperation(operation, prompt, options, { role: 'assistant', announceExhausted: false })
      : runForRole(role, prompt, options, { announceExhausted: false })
  },
  say,
  hire: (agent) => office('/event', { type: 'agent_spawned', agent }),
  working: (id, status) => office('/event', { type: 'agent_working', agentId: id, status }),
  finish: (id, info) => office('/event', { type: 'agent_completed', agentId: id, ...info }),
}

/** Start a command of this script on its own, so the chat watcher is not held up by a long job. */
async function detach(...args) {
  mkdirSync(homeDir, { recursive: true })
  const log = openSync(join(homeDir, 'delegation.log'), 'a', 0o600)
  let child
  try {
    child = fork(here, args, { detached: true, stdio: ['ignore', log, log, 'ipc'], windowsHide: true })
  } finally { closeSync(log) }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); done(new Error('Worker startup timed out')) }, 10_000)
    let settled = false
    const done = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', exited)
      if (child.connected) child.disconnect()
      child.unref()
      error ? reject(error) : resolve()
    }
    const exited = () => done(new Error('Worker exited before becoming ready'))
    child.once('error', done)
    child.once('exit', exited)
    child.once('message', message => { if (message?.ready) done() })
  })
}

async function launchPlan(job) {
  try {
    await detach('plan', Buffer.from(JSON.stringify(job)).toString('base64'))
  } catch {
    deps.write({ lastJob: { ...job, phase: 'plan', status: 'failed', failureKind: 'unavailable', at: deps.now() } })
    await say(job.name, job.role, 'No worker started: the planning process could not start. Check delegation.log in the office runtime directory.')
  }
}

async function runWorker(action) {
  const release = acquireProcessLock(join(homeDir, 'delegation.lock'))
  if (!release) {
    process.send?.({ ready: true })
    await say('Claude', 'assistant', delegationStatus(deps.read()))
    return
  }
  try {
    // Holding the reservation proves any busy marker left by the previous owner is stale.
    deps.write({ busy: undefined })
    process.send?.({ ready: true })
    await action()
  } catch (error) {
    console.error(`[delegation] ${error.stack ?? error}`)
    const state = deps.read()
    deps.write({ busy: undefined, lastJob: { ...state.lastJob, status: 'failed', failureKind: 'other', finishedAt: deps.now() } })
    await say(state.lastJob?.name ?? 'Claude', state.lastJob?.role ?? 'assistant', 'The worker stopped unexpectedly. No completion is confirmed. Check delegation.log in the office runtime directory.')
  } finally { release() }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'message') {
  const outcome = await handleMessage(deps, arg ?? '', launchPlan)
  process.stdout.write(outcome)
} else if (cmd === 'goal') {
  try { await detach('goal-run', arg ?? '/goal') } catch {
    await say('Claude', 'assistant', 'No worker started: the execution process could not start. No changes are confirmed.')
  }
  process.stdout.write('handled')
} else if (cmd === 'plan') {
  await runWorker(() => startPlan(deps, JSON.parse(Buffer.from(arg ?? '', 'base64').toString('utf8'))))
} else if (cmd === 'goal-run') {
  await runWorker(() => handleGoal(deps, arg ?? '/goal'))
} else {
  console.error('usage: delegate.mjs message|goal "<text>"')
  process.exit(2)
}
