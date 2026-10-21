/** Pure chat progress records. Ownership and timers belong to the office. */
export function isLiveStatus(status) {
  return !!status && ['received', 'routing', 'thinking', 'planning', 'working'].includes(status.state)
}

export function statusLabel(status, _now) {
  const name = status.agent?.name || 'Claude'
  switch (status.state) {
    case 'received': return 'Message received'
    case 'routing': return `Routing to ${name}: classifying the request…`
    case 'thinking': return `${name} is thinking…`
    case 'planning': return `${name} is preparing a plan…`
    case 'awaiting_approval': return status.detail || 'Plan ready: waiting for your approval'
    case 'working': return `${name} is working on the goal…`
    case 'done': return `${name} finished`
    case 'failed': return `${name} could not finish: ${status.detail || 'no answer was returned'}`
    default: return ''
  }
}

export function createChatStatus(update, now, id) {
  if (!update || !['received', 'routing', 'thinking', 'planning', 'awaiting_approval', 'working', 'done', 'failed'].includes(update.state)) return null
  const status = { id: String(update.id || id).slice(0, 100), state: update.state,
    agent: { name: String(update.agent?.name || 'Claude').slice(0, 80), role: String(update.agent?.role || 'assistant').slice(0, 80) },
    since: now, ...(update.detail ? { detail: String(update.detail).slice(0, 200) } : {}) }
  return { ...status, label: statusLabel(status, now) }
}

export function visibleStatus(status, now) {
  return status && !(status.state === 'done' && now - status.since >= 6000) ? status : null
}
