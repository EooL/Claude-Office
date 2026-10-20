/** Merge a persisted chat snapshot with messages that arrived while it was loading. */
export function mergeChatHistory<T extends { id: number }>(current: T[], saved: T[]): T[] {
  const rows = new Map<number, T>()
  for (const message of [...saved, ...current]) rows.set(message.id, message)
  return [...rows.values()].slice(-50)
}
