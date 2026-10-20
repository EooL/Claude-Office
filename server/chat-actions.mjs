import { FOLLOW_UP_INSTRUCTION, planId } from './delegation.mjs'

export { FOLLOW_UP_INSTRUCTION, planId }


// This explicit marker is a proposal, never executable model output.
export function nextAction(text) {
  const matches = [...String(text).matchAll(/^NEXT_ACTION:[ \t]*([^\r\n]{8,600})[ \t]*$/gm)]
  return matches.length === 1 ? matches[0][1].trim() : null
}

/** What a decision line says about the step: its first line, kept short. */
const gist = text => {
  const line = String(text).split('\n').find(l => l.trim()) ?? ''
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/**
 * Actions are derived from stored agent replies and current controller state, not client commands.
 * Accepting or declining one is written to the chat as a line of its own (`log`), so the history says what was
 * decided and when, next to what the agents proposed.
 */
export function mountChatActions(app, { db, requireUi, readState, enqueue, log = () => {}, paused = () => false, now = Date.now }) {
  db.exec('CREATE TABLE IF NOT EXISTS chat_action_approvals (action_id TEXT PRIMARY KEY, approved_at INTEGER NOT NULL)')
  const used = db.prepare('SELECT 1 FROM chat_action_approvals WHERE action_id = ?')
  const rows = () => db.prepare("SELECT * FROM messages WHERE is_system = 0 AND recipient IS NULL AND role NOT IN ('default','boss') AND (msg_type IS NULL OR msg_type NOT IN ('prompt','reply','goal')) ORDER BY id DESC LIMIT 50").all()
  function available() {
    const state = readState()
    let busy = state.busy && now() - state.busy.at < 30 * 60_000
    if (state.busy?.pid) {
      try { process.kill(state.busy.pid, 0); busy = true } catch (error) { busy = error.code !== 'ESRCH' }
    }
    if (busy) return []
    const messages = rows()
    const actions = []
    if (state.plan) {
      const expected = `Boss, I have a plan:\n${state.plan.plan}\n\nSay /goal to send me, or /goal <changes> to adjust it.`
      const shown = expected.length > 1800 ? `${expected.slice(0, 1799)}…` : expected
      const row = messages.find(m => m.sender === state.plan.name && m.text === shown && m.timestamp >= state.plan.at - 1000)
      if (row) {
        // The button goes on the newest line the agent said about the plan ("... Say /goal to approve execution",
        // which follows a failed attempt), not only on the plan itself far up in the chat.
        const latest = messages.find(m => m.sender === state.plan.name && m.timestamp >= state.plan.at && m.id > row.id && /\/goal/.test(m.text))
        // Each finished attempt makes a new approval: a plan whose execution failed stays pending, and the click that
        // started that attempt must not keep the plan from being approved again.
        const attempt = state.lastJob?.finishedAt && state.lastJob.finishedAt >= state.plan.at ? state.lastJob.finishedAt : 0
        actions.push({ id: `plan:${row.id}:${planId(state.plan)}:${attempt}`, messageId: (latest ?? row).id, kind: 'goal', label: 'Approve and execute plan', request: `${state.plan.goal}\n\n${state.plan.plan}`, command: `/goal --plan-id=${planId(state.plan)}` })
      }
    } else if (state.pending && now() - state.pending.at < 10 * 60_000) {
      const row = messages.find(m => m.sender === state.pending.name && m.text.startsWith('Boss, do you want me to take that on?') && m.timestamp >= state.pending.at - 1000)
      if (row) actions.push({ id: `pending:${row.id}`, messageId: row.id, kind: 'plan', label: 'Approve planning', request: state.pending.task, command: `Please investigate and plan this task: ${state.pending.task}` })
    } else {
      // Only the newest recommendation is actionable; a newer human request supersedes it.
      const latestHuman = db.prepare("SELECT MAX(id) AS id FROM messages WHERE role IN ('default','boss') AND is_system = 0 AND COALESCE(msg_type,'') != 'decision'").get()?.id ?? 0
      const row = messages.find(m => m.id > latestHuman && nextAction(m.text))
      if (row) actions.push({ id: `next:${row.id}`, messageId: row.id, kind: 'plan', label: 'Plan recommended step', request: nextAction(row.text), command: `Please investigate and plan this next step: ${nextAction(row.text)}` })
      if (state.lastJob?.status === 'failed') {
        const row = messages.find(m => m.sender === state.lastJob.name && m.timestamp >= (state.lastJob.finishedAt ?? state.lastJob.at))
        if (row) actions.push({ id: `retry:${row.id}`, messageId: row.id, kind: 'plan', label: 'Retry planning', request: state.lastJob.task, command: 'retry the last task' })
      }
    }
    return actions.filter(a => !used.get(a.id))
  }
  app.get('/chat/actions', requireUi, (_req, res) => res.json({ actions: available().map(({ command, ...a }) => a), paused: paused() }))
  /** Records the decision on an action; false when it was already decided (a repeated click). */
  const claim = action => db.prepare('INSERT OR IGNORE INTO chat_action_approvals VALUES (?, ?)').run(action.id, now()).changes > 0

  app.post('/chat/actions/approve', requireUi, (req, res) => {
    if (paused()) return res.status(409).json({ error: 'AI is paused. Enable AI before approving a step.' })
    const action = available().find(a => a.id === req.body?.id)
    if (!action) return res.status(409).json({ error: 'This recommendation was used or superseded. Check the latest plan.' })
    // Same SQLite transaction: a repeated click cannot enqueue the operation twice.
    const approved = db.transaction(() => (claim(action) ? enqueue(action.command, action.kind === 'goal' ? 'goal' : null) : null))()
    if (approved) log(`✔ Approved: ${action.label} — ${gist(action.request)}`) // after the commit: a failed enqueue leaves no line
    if (!approved) return res.status(409).json({ error: 'This step was already approved.' })
    res.json({ ok: true, kind: action.kind, messageId: approved.id })
  })
  // Saying no is a decision too: nothing is started, the step is not offered again, and the chat records it.
  app.post('/chat/actions/decline', requireUi, (req, res) => {
    const action = available().find(a => a.id === req.body?.id)
    if (!action) return res.status(409).json({ error: 'This recommendation was used or superseded. Check the latest plan.' })
    const declined = claim(action)
    if (declined) log(`✖ Declined: ${action.label} — ${gist(action.request)}`)
    if (!declined) return res.status(409).json({ error: 'This step was already decided.' })
    res.json({ ok: true, kind: action.kind })
  })
}
