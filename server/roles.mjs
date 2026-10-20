// roles.mjs — which office agent a chat message is for. The one routing table: the chat
// watcher (scripts/chat-ai-watcher.sh) and the delegation flow (server/delegation.mjs)
// both use it, and Settings lists the same roles to pick a service for each.
//
//   node server/roles.mjs route "<message>"   prints  role|Name
import { pathToFileURL } from 'node:url'

export const ROLES = [
  { role: 'debugger', name: 'Debugger', words: ['bug', 'error', 'crash', 'fix', 'broken', 'debug', 'exception', 'traceback', 'stack trace', 'segfault'] },
  { role: 'code-reviewer', name: 'Reviewer', words: ['review', 'pr', 'merge', 'approve', 'lgtm', 'pull request', 'code review', 'diff'] },
  { role: 'frontend-developer', name: 'Frontend', words: ['css', 'ui', 'ux', 'component', 'design', 'frontend', 'style', 'layout', 'responsive', 'tailwind', 'animation', 'pixel', 'theme', 'dark mode', 'light mode', 'color', 'font', 'spacing', 'padding', 'margin'] },
  { role: 'test-engineer', name: 'Tester', words: ['test', 'coverage', 'spec', 'jest', 'pytest', 'unit test', 'e2e', 'playwright', 'cypress', 'assertion', 'mock'] },
  { role: 'security-auditor', name: 'Security', words: ['security', 'auth', 'vuln', 'xss', 'injection', 'csrf', 'cors', 'token', 'jwt', 'oauth', 'password', 'encrypt', 'ssl', 'tls', 'certificate'] },
  { role: 'devops-engineer', name: 'DevOps', words: ['deploy', 'ci', 'pipeline', 'docker', 'devops', 'kubernetes', 'k8s', 'terraform', 'aws', 'gcp', 'azure', 'vercel', 'netlify', 'heroku', 'nginx', 'cdn', 'dns', 'domain', 'ssl cert'] },
  { role: 'performance-engineer', name: 'PerfEng', words: ['perf', 'slow', 'optimize', 'speed', 'latency', 'bundle', 'lighthouse', 'core web vitals', 'memory leak', 'cache', 'lazy load', 'render', 'fps', 'bottleneck'] },
  { role: 'database-architect', name: 'DBA', words: ['db', 'query', 'schema', 'migration', 'sql', 'postgres', 'mysql', 'mongo', 'redis', 'index', 'join', 'table', 'row', 'column', 'orm', 'prisma', 'drizzle', 'supabase', 'neon'] },
  { role: 'typescript-pro', name: 'TS Pro', words: ['typescript', 'type', 'interface', 'generic', 'enum', 'union', 'infer', 'zod', 'validation', 'schema'] },
  { role: 'ai-engineer', name: 'AI Eng', words: ['ai', 'llm', 'prompt', 'model', 'openai', 'anthropic', 'embedding', 'vector', 'rag', 'agent', 'token', 'context window'] },
  { role: 'fullstack-developer', name: 'Fullstack', words: ['api', 'endpoint', 'rest', 'graphql', 'webhook', 'route', 'middleware', 'request', 'response', 'http', 'fetch', 'axios', 'cors'] },
  { role: 'code-reviewer', name: 'Reviewer', words: ['git', 'branch', 'commit', 'rebase', 'cherry-pick', 'stash', 'conflict', 'remote', 'origin'] },
  { role: 'architect-reviewer', name: 'Architect', words: ['refactor', 'clean', 'abstract', 'pattern', 'solid', 'dry', 'yagni', 'architecture', 'module', 'package', 'monorepo'] },
]

export const DEFAULT_ROLE = { role: 'assistant', name: 'Claude' }

/** The first role whose keywords the message contains (substring, like the original table), else the assistant. */
export function routeMessage(text) {
  const msg = String(text).toLowerCase()
  const hit = ROLES.find((r) => r.words.some((w) => msg.includes(w)))
  return hit ? { role: hit.role, name: hit.name } : DEFAULT_ROLE
}

// The office's chain of command for the Team chart in Settings: who each role reports to (a role
// that is not listed reports to the boss). The chart is the only thing that reads this.
const REPORTS_TO = {
  'frontend-developer': 'architect-reviewer',
  'fullstack-developer': 'architect-reviewer',
  'typescript-pro': 'architect-reviewer',
  'database-architect': 'architect-reviewer',
  'ai-engineer': 'architect-reviewer',
  'test-engineer': 'code-reviewer',
  'security-auditor': 'code-reviewer',
  debugger: 'code-reviewer',
  'performance-engineer': 'devops-engineer',
}

// What each role's work asks of a model, for the recommendations in Settings (server/recommend.mjs):
// the tier of model (fast, balanced, strong), how hard it should reason, and why.
export const PROFILES = {
  assistant: { tier: 'fast', effort: 'low', why: 'Quick conversational replies: speed matters more than depth.' },
  debugger: { tier: 'strong', effort: 'high', why: 'Tracks a fault across files to its root cause, which pays off from deep reasoning.' },
  'code-reviewer': { tier: 'strong', effort: 'high', why: 'Has to catch subtle bugs and risks, so thoroughness beats speed.' },
  'security-auditor': { tier: 'strong', effort: 'high', why: 'A missed vulnerability is costly: it needs the most careful reasoning.' },
  'database-architect': { tier: 'strong', effort: 'high', why: 'Schema and migration mistakes are expensive to undo.' },
  'architect-reviewer': { tier: 'strong', effort: 'high', why: 'Weighs trade-offs across the whole codebase before anything changes.' },
  'performance-engineer': { tier: 'strong', effort: 'medium', why: 'Needs a strong model to read profiles, but not the slowest reasoning.' },
  'frontend-developer': { tier: 'balanced', effort: 'medium', why: 'Everyday UI work: a balanced model is fast and good enough.' },
  'fullstack-developer': { tier: 'balanced', effort: 'medium', why: 'Mixed, well-bounded tasks suit a balanced model.' },
  'typescript-pro': { tier: 'balanced', effort: 'medium', why: 'Type-level work is precise but rarely needs the largest model.' },
  'ai-engineer': { tier: 'balanced', effort: 'medium', why: 'Prompt and pipeline work: balanced speed and quality.' },
  'test-engineer': { tier: 'balanced', effort: 'medium', why: 'Writing tests is structured work a balanced model does well.' },
  'devops-engineer': { tier: 'balanced', effort: 'medium', why: 'Config and pipeline edits are routine but need care.' },
}

/** Every distinct role an agent can have in the office, the assistant first, with who it reports to (null: the boss). */
export function listRoles() {
  const seen = new Map([[DEFAULT_ROLE.role, { ...DEFAULT_ROLE, reportsTo: null }]])
  for (const r of ROLES) if (!seen.has(r.role)) seen.set(r.role, { role: r.role, name: r.name, reportsTo: REPORTS_TO[r.role] ?? null })
  return [...seen.values()]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, text] = process.argv.slice(2)
  if (cmd !== 'route' || text === undefined) { console.error('usage: roles.mjs route "<message>"'); process.exit(2) }
  const { role, name } = routeMessage(text)
  process.stdout.write(`${role}|${name}`)
}
