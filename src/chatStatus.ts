export type { ChatStatus } from '../server/chat-status.mjs'
export { isLiveStatus, statusLabel, visibleStatus } from '../server/chat-status.mjs'

/** Presentation only: keep the original row intact for approvals and storage. */
export function displayChatText(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
}
