import { createOfficeContext } from './office-context.mjs'
import { createOfficeState } from './office-state.mjs'
import { openChatDb } from './chat-store.mjs'
import { createOfficeAuth } from './office-auth.mjs'
import { join } from 'node:path'

/** Own state, SQLite and secrets (read from its token file, never written here); listeners and timers belong to the server. */
export function createOffice({ home, cwd }) {
  const context = createOfficeContext({ home, cwd })
  const state = createOfficeState()
  const chat = openChatDb(context.home)
  const auth = createOfficeAuth(join(context.home, 'auth-token'))
  return { context, state, chat, auth, close: () => { clearTimeout(state.chatStatusTimer); state.chatStatusTimer = null; chat.close() } }
}
