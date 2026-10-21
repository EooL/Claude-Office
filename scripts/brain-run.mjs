// brain-run.mjs — run a prompt as an office agent, on its brain (server/brains.mjs): the first step that is
// available, and when one is not (5-hour or weekly window used, no credits, model or service down) the next.
// Used by the chat replies (scripts/chat-backend.mjs), the orchestrator's decisions and the jobs agents are
// handed (scripts/delegate.mjs).
import { adapters, runAdapter } from '../server/adapters.mjs'
import { claudeWindowBlock, describeFailure, noteUsed, operationSteps, resolveSteps, runWithBrain, switchNotice } from '../server/brains.mjs'
import { listRoles } from '../server/roles.mjs'
import { getStatus, say } from './office-client.mjs'
import { reportUsage } from './report-usage.mjs'

/** Why a step is out for now: a failure remembered earlier, or (for Claude) a full 5-hour / weekly window. */
async function blocked(step) {
  return step.service === 'claude' ? claudeWindowBlock(await getStatus()) : null
}

/**
 * Run `prompt` on a list of steps, with the notices an agent gives when its brain moves. `speaker` is who says
 * it in the chat ({ name, role }); `key` tells apart what a switch is remembered for.
 */
async function runSteps({ steps, key, speaker }, prompt, opts, { announceExhausted }) {
  if (steps.length === 0) {
    if (announceExhausted) await say(speaker.name, speaker.role, 'Boss, no AI service is enabled for me. Turn one on in Settings > Services.')
    return { text: '', code: 1, error: 'no AI service is enabled', usage: {}, reported: [], model: '', durationMs: 0, attempts: [], exhausted: true }
  }
  const result = await runWithBrain({
    steps,
    prompt,
    opts,
    blocked,
    run: async (service, p, o) => {
      // a slow CLI keeps its own longer limit
      const r = await runAdapter(service, p, { ...o, timeoutMs: Math.max(o.timeoutMs ?? 0, adapters[service]?.timeoutMs ?? 0) })
      await reportUsage(service, r)
      return r
    },
  })
  if (result.step) {
    const notice = switchNotice(steps, result.step, noteUsed(key, result.step), result.attempts)
    if (notice) await say(speaker.name, speaker.role, notice)
  } else if (announceExhausted) {
    const why = result.attempts.map((a) => `${a.step.label || a.step.service} ${describeFailure(a.failed ?? a.skipped)}`).join('; ')
    await say(speaker.name, speaker.role, `Boss, every brain I have is out for now${why ? ` (${why})` : ''}. I will try again soon.`)
  }
  return result
}

const speakerFor = (role) => ({ name: listRoles().find((r) => r.role === role)?.name ?? role, role })

/**
 * Run `prompt` for an office operation: 'chat' (a reply, spoken by office role `role`) or 'orchestrator' (the
 * decision that a message is a job). Resolves like runWithBrain (`step` is the one that worked, `attempts` what
 * was skipped or failed on the way). The speaker says so in the chat when the brain moves to another step, once,
 * and when none works (unless announceExhausted is false: the caller says it).
 */
export function runForOperation(operation, prompt, opts = {}, { role = 'assistant', announceExhausted = true } = {}) {
  // one brain per operation, so a switch is announced once, by whoever is speaking at that moment
  return runSteps({ steps: operationSteps(operation), key: operation, speaker: speakerFor(role) }, prompt, opts, { announceExhausted })
}

/** Run `prompt` as an agent: its own brain, else the one inherited, else the orchestrator's. */
export function runForRole(role, prompt, opts = {}, { announceExhausted = true } = {}) {
  return runSteps({ steps: resolveSteps(role), key: role, speaker: speakerFor(role) }, prompt, opts, { announceExhausted })
}
