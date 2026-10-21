# Job description ("fisa postului") for every office agent: standards and options

Goal: every agent, whichever brain (Claude Code, Codex, Antigravity, OpenCode, Qoder) runs it, has one document that says who it is, what it does, what it may use, what it may do, what it must not do, who it reports to and how it hands work over. Today this is spread out: `server/roles.mjs` (role ids, names, routing keywords, `REPORTS_TO`, model `PROFILES`), one line in `planPrompt`/`goalPrompt` in `server/delegation.mjs` ("You are {name}, the office {role}..."), the access rules in `server/adapters.mjs` (`docs/adapter-contract.md`) and an office-wide A2A card at `/.well-known/agent-card.json`.

## What already exists on the internet (checked)

| Standard | What it describes | Format | Fit for this project |
| --- | --- | --- | --- |
| [Claude Code subagent files](https://code.claude.com/docs/en/sub-agents) | One agent: identity, when to use it, tools, limits, model, permissions, preloaded skills, MCP servers, hooks, memory. The Markdown **body is the agent's system prompt**. | Markdown + YAML frontmatter. Required: `name`, `description`. Optional: `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt` | **Best match for a job description.** It is the closest thing to a de-facto "agent description document", and its frontmatter maps onto what the office enforces. Claude Code reads such files natively. |
| [A2A Agent Card](https://a2a-protocol.org/latest/specification/) (Linux Foundation) | How *other agents* find and call this agent: name, description, version, endpoint(s), `capabilities` (streaming, push notifications, extended card), `securitySchemes`/`security`, input/output modes, `skills[]` (`id`, `name`, `description`, `tags`, `examples`), optional signatures. Served at `/.well-known/agent-card.json` (older: `agent.json`). | JSON | **Already in use** (`/a2a` and an office card exist). Right for the *external face* of each agent, wrong for "what must it not do". Generate it from the job description. |
| [AGENTS.md](https://agents.md) (Agentic AI Foundation, Linux Foundation; adopted by Codex, opencode, Copilot coding agent, Jules, Aider, goose...) | Project-wide instructions for coding agents: build/test commands, code style, security, commit rules. No required fields, nearest file wins. | Plain Markdown | The **shared rules every agent inherits** (one per project). Complements, does not replace, a per-agent description. |
| [Agent Skills (SKILL.md)](https://agentskills.io/specification) (Anthropic, Dec 2025; Claude Code, Codex, Cursor, Gemini CLI) | A reusable capability: `name` (<=64, lowercase), `description` (<=1024, when to use), optional `license`, `compatibility`, `metadata`, `allowed-tools`; folder with `scripts/`, `references/`, `assets/`; loaded progressively. | Markdown + YAML | For **capabilities an agent can be given** ("write a migration", "triage a crash"), referenced from the job description's `skills`. |
| [Oracle Open Agent Specification](https://github.com/oracle/agent-spec) | A framework-neutral definition of agents *and flows* that runs on several runtimes (LangGraph, CrewAI, AutoGen, WayFlow). | JSON/YAML + SDKs | Heavy: a workflow language. Only if the office later needs portable multi-step flows. |
| [AGNTCY OASF](https://docs.agntcy.org/oasf/open-agentic-schema-framework/) (Cisco/Outshift) | Records for a public agent **directory**: name, version, authors, description, tagged skills/domains, modules. | JSON records | For discovery in a registry across organisations. Not needed for a local office. |
| IETF Internet-Draft "AgentCard" (draft-aevum-agentcard-00, April 2026) | Another card format (`agent_id`, `name`, `version`, `capabilities`, `endpoint`). | JSON | A different, non-A2A format; watch, do not adopt. |

Community collections of ready-made role descriptions for Claude Code exist (for example [wshobson/agents](https://github.com/wshobson/agents), the [VoltAgent list](https://dev.to/voltagent/100-claude-code-subagent-collection-1eb0), lst97's `claude-code-sub-agents`) with roles such as code-reviewer, security-auditor, architect-reviewer and typescript-pro. They can seed the prose. I did not find a single collection that matches all 12 office roles, so each text must be reviewed, and each repository's licence checked before copying.

## Recommended shape: one profile file per role, everything else derived

`agents/<role>.md` (defaults in the repo, the owner's edits in the office home): the Claude Code subagent format plus a small `office:` block.

```markdown
---
name: debugger
description: Finds the root cause of a bug, crash or failing test and proposes the smallest fix. Use for errors, stack traces, "it broke after...".
tools: Read, Grep, Glob, Bash(read-only)     # what it may use
disallowedTools: Write, Edit                  # in plan/chat; Edit allowed only after an approved plan
model: strong            # office tier from PROFILES: fast | balanced | strong
effort: high
office:
  displayName: Debugger
  reportsTo: code-reviewer
  routes: [bug, error, crash, fix, exception, traceback]
  access: { chat: none, plan: read, write: edit-after-approval }
  mayDelegateTo: [test-engineer]
  escalatesTo: boss
---
# Who you are
You are the Debugger of this office, a senior engineer who ...

# Mission and responsibilities
...
# What you receive / what you hand back
Input: ... Output: a root cause, the evidence (file:line), the smallest fix, a test that fails before and passes after.

# What you must not do
Never change code in plan or chat mode. Never run destructive commands. Never commit or push. ...

# Ask the boss first when
...
# Definition of done
...
```

Derived automatically from that one file:
1. **The prompt** every brain receives (replaces the one-line "You are ..." in `planPrompt`/`goalPrompt`; same text for every CLI, so behaviour does not depend on the brain).
2. **The A2A Agent Card** for each agent (`skills` from the responsibilities, `description`, security scheme of the office) next to the existing office card.
3. **The access check**: `access` and `tools` must not exceed what `server/adapters.mjs` enforces for the mode; a test fails if a profile asks for more than the adapter contract can guarantee (for example "plan: read only" on Antigravity, which cannot promise it today).
4. **The Team tab** in Settings (who reports to whom, what each does) and a "Job description" editor with preview and diff.
5. **Export** to `.claude/agents/<role>.md` so Claude Code can use the same files directly.

## Auto-completion for the current agents (13: Claude the assistant, Debugger, Reviewer, Frontend, Tester, Security, DevOps, PerfEng, DBA, TS Pro, AI Eng, Fullstack, Architect)

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| **A. Rules only** | Build the frontmatter and a skeleton from data we already have: role id/name, routing keywords, `REPORTS_TO`, `PROFILES` (tier, effort, why), the access table of the adapter contract. Prose sections from short fixed templates per role family. | Free, deterministic, instantly consistent with the code; no hallucinated tools. | Prose is thin and generic. |
| **B. LLM only** | One call per role to a strong brain through the existing brain chain, from a fixed template plus the role's data and the project's AGENTS.md/README. | Rich, project-aware text. | Costs quota; can invent capabilities; needs validation. |
| **C. Hybrid (recommended)** | A builds and **validates** the structural part (identity, reporting line, tools, access, model). B fills only the prose sections (mission, responsibilities, must-not, escalation, definition of done) under a strict schema with length caps; the result is saved as `status: draft` and becomes active only after the owner approves it (with a diff). A "regenerate this section" action reuses the same call. | Structure is always correct; text is good; nothing goes live unreviewed. | Two steps; the first approval pass is manual (13 short reviews). |
| **D. Seed from the community** | Start the prose from the closest community role description (licence permitting) and adapt it with B. | Proven wording for common roles. | Licence work; texts not tailored to this office. |

Safeguards for B/C: the model may only name tools and skills that exist in a closed vocabulary; every profile is validated against a JSON Schema; generation never touches a role the owner marked `locked`; the generated text is versioned with a hash so a later regeneration shows a diff, not a silent overwrite.

## Suggested order
1. Define the profile schema (frontmatter + required sections) and the loader; ship option A defaults for all 13 roles so every agent has a complete, valid description at once.
2. Switch `planPrompt`/`goalPrompt` to the profile (same text for every brain); add the access-vs-adapter-contract test.
3. Generate the A2A cards and the Team/Job-description screens.
4. Run option C to enrich the prose, with the review step.
5. Optional: export to `.claude/agents/`, and a project-level `AGENTS.md` for the rules all agents share.

Open decisions for the owner: where the files live (repo defaults plus per-office overrides, as proposed), whether the profile text is shown to the boss in the chat, and which community collections (if any) may be used as a seed.

Sources: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [A2A specification](https://a2a-protocol.org/latest/specification/), [Google Cloud AgentCard reference](https://docs.cloud.google.com/gemini/data-agents/reference/rest/Shared.Types/AgentCard), [AGENTS.md](https://agents.md), [Agent Skills specification](https://agentskills.io/specification), [Oracle Agent Spec](https://github.com/oracle/agent-spec), [AGNTCY OASF](https://docs.agntcy.org/oasf/open-agentic-schema-framework/), [IETF draft AgentCard](https://www.ietf.org/ietf-ftp/internet-drafts/draft-aevum-agentcard-00.html).

---

## Implementation status (2026-10-21)

Built as recommended (option C, hybrid):
- **Profiles:** `server/agent-profiles.mjs` (parser for a restricted YAML subset, validator, `defaultProfile`, load/save/reset, prompt, A2A card, Claude Code export, access check) with the 13 shipped files in `server/agent-profiles/*.md` (generated by `scripts/gen-agent-profiles.mjs`, drift-guarded by a test). Overrides live in `<office home>/agent-profiles/<role>.md`. V2 adds source lines to validation errors and a grouped access summary for Settings-enabled services, preserving the existing access checks.
- **Routes** (`server/index.js`): `GET /profiles`, `GET /profiles/:role`, `…/card`, `…/claude`, `POST …/validate`, `PUT …`, `POST …/approve`, `DELETE …`, `POST …/enrich` (UI token for the writes; 501 for a non-default office).
- **Prompts:** `planPrompt`, `goalPrompt` and the chat reply prompt use the agent's job description (fallback to the old text if a profile cannot be loaded). V2 replaces the chat watcher's introduction in place, preserving its other text and LF/CRLF, so there is one introduction.
- **UI:** Settings > Agents has a role/status sidebar and full-height job description (view, edit with live validation, save draft, save and approve, reset, show changes, Claude Code export, A2A card, enrich draft). Saves are disabled while checking or invalid; located errors focus their source line. A single optional access notice expands into service details. Team retains brain selection and links to the selected role in Agents. Older servers may omit error lines or the access summary.
- **Enrichment:** `server/agent-enrich.mjs` and `scripts/enrich-agent-profiles.mjs` (one chat call per role on the owner's subscription, strict JSON validation, baseline must-not rules always kept, result is an unsaved draft until the owner saves it). Not run against a real service yet.
- Tests: `agent-profiles` (89), `agent-profile-routes` (10), `agent-profile-enrich-route` (6), `agent-profile-prompts` (7), `agent-enrich` (21), `job-description` (12). V2 focused integration: 4 files, 118 passed. The single full serial run found one stale watcher-introduction assertion; it was updated and its file rerun successfully. Combined verification: 87 files, 1,403 passed, 15 existing skips; build passed. Exact command results and remaining browser/live-service limits: [job-description-v2-results.md](job-description-v2-results.md).
