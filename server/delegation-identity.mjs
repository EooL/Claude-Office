/** Authenticated event metadata is still bounded before it reaches persistence or the UI. */
export function cleanCreator(value) {
  if (!value || !['boss', 'orchestrator', 'agent'].includes(value.kind) || typeof value.name !== 'string' || !value.name.trim()) return undefined
  return { kind: value.kind, name: value.name.trim().slice(0, 100), ...(Number.isSafeInteger(value.messageId) && value.messageId > 0 ? { messageId: value.messageId } : {}) }
}

export function reportBackText(text, task, creator) {
  return creator ? `${creator.name} — Re: ${String(task).replace(/\s+/g, ' ').slice(0, 120)}\n${text}` : text
}
