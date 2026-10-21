/** Allocate the mutable state of one office, without starting any resources. */
export function createOfficeState() {
  return {
    activeAgents: new Map(),
    subagentAliases: new Map(),
    pendingStarts: new Map(),
    activity: new Map(),
    sessions: new Map(),
    sessionTimers: new Map(),
    pendingNeedsYou: new Map(),
    needsYouTimers: new Map(),
    waitCalls: new WeakMap(),
    settings: { logPrompts: 'summary', answerPermissions: true, eventMode: 'real' },
    signalRing: [],
    sessionSignals: new Map(),
    a2aPairLog: new Map(),
    trustedClients: new WeakSet(),
    signalSeq: 0,
    videoPaused: false,
    videoPausedSince: 0,
  }
}
