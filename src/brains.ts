/**
 * brains.ts — the shapes the Brain Profiles screens share with the server (GET /brains, server/brainRoutes.js).
 * A brain is an ordered chain of steps; the first one is used and the next takes over when it is used up or
 * unavailable. An auto brain's steps are recommended from the installed services' models.
 */

export type Tier = 'fast' | 'balanced' | 'strong'

export interface Blocked {
  kind: string
  until: number
  message?: string
  /** which usage window a limit is about: '5h', 'weekly' or 'spend' */
  window?: string
}

export interface BrainStep {
  service: string
  model: string
  effort: string
  label?: string
  why?: string
  blocked?: Blocked | null
}

export interface Brain {
  id: string
  name: string
  builtin: boolean
  auto?: boolean
  tier?: Tier
  effort?: string
  steps: BrainStep[]
}

/** What one operation of the office (the chat, the agent orchestrator) runs on: its brain, or null for the default service */
export interface OperationInfo {
  brain: string | null
  steps: BrainStep[]
}

export type Operation = 'chat' | 'orchestrator'

export interface BrainsOverview {
  operations: Record<Operation, OperationInfo>
  recommendedOperations: Record<Operation, { id: string; why: string }>
  /** the agents with no brain, own or inherited */
  unconfigured?: string[]
  brains: Brain[]
  /** role -> the brain linked to that agent directly */
  agents: Record<string, string>
  /** role -> the brain it really uses and the role it comes from, or null for the office-wide service */
  effective: Record<string, { id: string; from: string } | null>
  recommended: Record<string, { id: string; why: string }>
  cooldowns: Record<string, Blocked>
  catalogue: { builtAt: number; count: number; unsure: number }
}

export interface CatalogueModel {
  service: string
  id: string
  label: string
  note?: string
  efforts: string[]
  billing: string
  tier: Tier
  confidence: number
}

export const TIER_LABEL: Record<Tier, string> = { fast: 'Fast', balanced: 'Balanced', strong: 'Strong' }

/** Why a step is out for now, in a few words: a limit says which window it is. */
export function blockedText(b: Blocked): string {
  if (b.kind === 'limit' && b.window) return ({ '5h': '5-hour limit reached', weekly: 'weekly limit reached', spend: 'spend limit reached' } as Record<string, string>)[b.window] ?? 'usage limit reached'
  return KIND_TEXT[b.kind] ?? b.kind
}

/** Why a step is out for now, in a few words. */
export const KIND_TEXT: Record<string, string> = {
  limit: 'usage limit reached',
  credits: 'out of credits',
  unavailable: 'not available',
  model: 'model not available',
  auth: 'needs a login',
  permission: 'headless tool permission denied',
  probing: 'checking service recovery',
  other: 'did not answer',
}

/** "back at 14:20", or the date when it is not today. */
export function untilText(until: number, now = Date.now()): string {
  const d = new Date(until)
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === new Date(now).toDateString()) return `back at ${clock}`
  return `back ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`
}
