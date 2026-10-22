import { canonicalCwd } from '../server/canonicalCwd.mjs'

/** Legacy watchers pass text only; recover its stored row without inventing a message id. */
export async function delegationContext(read, text, cwd, messageId) {
  const history = await read('/chat')
  const rows = (history?.messages ?? []).filter(row => row.text === text && (!messageId || row.id === messageId)).sort((a, b) => b.id - a.id)
  // Identical concurrent requests cannot be disambiguated by a text-only caller.
  const row = rows.length === 1 ? rows[0] : undefined
  const creator = row && !['boss', 'default'].includes(row.role)
    ? { kind: 'agent', name: row.sender, messageId: row.id }
    : { kind: 'boss', name: 'Boss', ...(row ? { messageId: row.id } : {}) }
  const matches = (await read('/sessions'))?.sessions?.filter(session => session.state === 'active' && session.cwd && canonicalCwd(session.cwd) === canonicalCwd(cwd)) ?? []
  const session = matches.find(session => session.source !== 'office-chat') ?? matches[0]
  return { cwd, sessionId: session?.id ?? 'office-chat', createdBy: creator, routedBy: 'assistant' }
}
