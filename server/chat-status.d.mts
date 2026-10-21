export interface ChatStatus {
  id: string
  state: 'received' | 'routing' | 'thinking' | 'planning' | 'awaiting_approval' | 'working' | 'done' | 'failed'
  agent: { name: string; role: string }
  label: string
  since: number
  detail?: string
}
export function isLiveStatus(status: ChatStatus | null | undefined): boolean
export function statusLabel(status: ChatStatus, now?: number): string
export function createChatStatus(update: Partial<ChatStatus>, now: number, id: string): ChatStatus | null
export function visibleStatus(status: ChatStatus | null | undefined, now: number): ChatStatus | null
