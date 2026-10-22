import { chatTokens } from '../server/chat-markup.mjs'
import { displayChatText } from './chatText'

/** Logical rendered text, excluding markdown targets and hidden control comments. */
export function chatPreview(text: string) {
  const rendered = chatTokens(displayChatText(text)).map(token => token.label).join('')
  const lines = rendered.split('\n')
  const long = rendered.length > 900 || lines.length > 12
  const lineLimit = lines.slice(0, 12).join('\n').length
  return { long, characters: Math.min(900, lineLimit) }
}
