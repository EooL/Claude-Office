/** Compatibility facade for the default office's SQLite chat instance. */
import { defaultOffice } from './default-office.mjs'

export { openChatDb, MAX_REACTIONS } from './chat-store.mjs'

export const { addMessage, getMessages, markInboxRead, markSeen, addReaction, getThread } = defaultOffice.chat
export default defaultOffice.chat.db
