// Storage and transport share this bound; hook session prompts have their own limit.
export const CHAT_MESSAGE_LIMIT = 20_000
export const DELEGATION_CHAT_LIMIT = 8_000

export function clipDelegationChat(text) {
  return text.length > DELEGATION_CHAT_LIMIT ? `${text.slice(0, DELEGATION_CHAT_LIMIT - 1)}…` : text
}
