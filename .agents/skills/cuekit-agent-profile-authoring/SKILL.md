---
name: cuekit-agent-profile-authoring
description: Use when designing, reviewing, or safely editing cuekit Agent Profiles for a project. Supports interactive profile authoring and review of existing .cuekit/agents/*.md / ~/.cuekit/agents/*.md profiles. Always proposes changes first and only writes profile files after explicit user approval.
---

# Cuekit Agent Profile Authoring

Use this skill when a user wants to create, improve, or review cuekit Agent Profiles for their project.

Primary modes:

- **Design mode**: interactively design one or more project-specific profiles.
- **Review mode**: inspect existing profiles and recommend focused fixes.

This skill is for **Agent Profiles**, not Team Strategies. If the user asks to design `.cuekit.yaml` strategies, use the strategy-authoring skill instead.

## Hard Gate: No Unapproved Writes

Do **not** create or edit profile files until the user explicitly approves the proposed profile content or patch.

Allowed before approval:

- Read project files and existing profiles.
- Ask questions.
- Propose profile IDs, scope, frontmatter, and instructions.
- Review existing profiles and list issues.
- Show a planned diff or exact file content.

Only after approval:

- Create or edit `.cuekit/agents/*.md` or `~/.cuekit/agents/*.md`.
- Run validation commands that depend on the new files.

## Context Discovery

Start by reading the relevant context. Prefer project-local context first.

1. Project config:
   - `.cuekit.yaml`
   - `.cuekit/agents/*.md` if present
2. Project docs:
   - `README.md`
   - `AGENTS.md`
   - `docs/README.md`
   - relevant architecture/design docs if the profile targets a specific subsystem
3. Existing global profiles only when needed:
   - `~/.cuekit/agents/*.md`
4. Cuekit profile docs when unsure:
   - `docs/guides/agent-profiles.md`
   - `docs/designs/cuekit-agent-profiles-design.md`

Summarize what already exists before proposing new profiles.

## Choosing Profile Scope

Default to project-local profiles:

```text
<project>/.cuekit/agents/<id>.md
```

Use user-global profiles only when the profile is intentionally reusable across unrelated projects:

```text
~/.cuekit/agents/<id>.md
```

Explain the scope decision before proposing file writes.

## Design Mode Workflow

When creating a profile from scratch, ask concise questions. Prefer one question at a time.

Minimum questions:

1. What job should this profile perform?
2. Is this a new role, or should it override/extend a builtin role?
3. Which agent runtime should normally execute it (`claude-code`, `pi`, `opencode`, `gemini`, `jcode`, etc.)?
4. Is a default model needed, or should callers/strategies choose the model?
5. Should instructions replace or append to a lower-scope profile?

Then propose:

- profile `id`
- file path
- scope: project or user
- whether it is new / override / append override
- `agent_kind`
- `model` or explicit omission
- tags
- full instruction body
- validation plan

Ask for approval before writing.

## Review Mode Workflow

When reviewing existing profiles, check each profile for:

1. **Schema correctness**
   - `id` exists and is not `auto`
   - `description` is present after merge
   - body instructions are non-empty after merge
   - `instructions_mode` is either `replace` or `append`
2. **Scope and precedence**
   - project > user > builtin
   - override intent is clear
   - `append` is used only when lower-scope instructions should remain active
3. **Agent/model compatibility**
   - `agent_kind` and `model` are compatible
   - avoid inheriting model defaults across incompatible agent overrides
   - if unsure, omit `model` and let submit/strategy choose it
4. **Role clarity**
   - instructions describe a bounded job
   - output expectations are explicit
   - success/failure reporting is clear
5. **Cuekit substrate boundaries**
   - no auto-wake / auto-steer / scheduler promises
   - no recursive team spawning unless explicitly intended and supported
   - no claims that replace the parent/coordinator decision-maker
6. **Final reporting contract**
   - profile instructions must not override cuekit's final reporting contract
   - terminal report types should be used correctly (`completed`, `failed`, `blocked`)
   - `help_requested` is non-terminal parent-input reporting
7. **Auto-selection friendliness**
   - description and tags are specific enough for deterministic role selection
   - avoid vague role ids like `helper` or `expert`

Report findings grouped by severity:

- Critical: profile can break task submission or produce unsafe behavior.
- Important: likely to misroute agents, choose incompatible models, or confuse final reports.
- Medium: unclear role boundaries, weak selection hints, missing validation.
- Low: wording/style polish.

For each issue, provide a concrete fix suggestion.

## Profile Format Template

Use this template for new profiles:

```md
---
id: <profile-id>
description: <short human-readable purpose>
agent_kind: <optional runtime adapter>
model: <optional runtime model>
tags:
  - <tag>
instructions_mode: replace
---

Mission:
<One short paragraph describing the bounded job.>

Operating rules:
- <Concrete rule 1>
- <Concrete rule 2>
- Do not override cuekit's final reporting contract; role instructions are subordinate to cuekit's operational instructions.

Output expectations:
<What the child should report, including evidence, files, validation, risks, and blockers.>
```

When overriding a builtin profile with additive project guidance, prefer:

```md
---
id: reviewer
instructions_mode: append
---

Project-specific review checklist:
- <local rule>
```

Do not include `source`, `file_path`, or `file_paths`; cuekit injects those.

## Agent/Model Compatibility Guidance

Rules of thumb:

- If `agent_kind` is omitted, the caller, strategy, or lower-scope profile may provide it.
- If `model` is omitted, the adapter default or caller/strategy can decide.
- If a project profile changes `agent_kind` from a lower-scope profile, be cautious about inheriting `model`.
- Avoid pairing `pi` with Claude-only model names such as `sonnet` unless the local Pi model provider explicitly supports that model identifier.
- Prefer omitting `model` for profiles intended to run under multiple adapters.

## Common Pitfalls

Avoid:

- `id: auto` — reserved.
- Huge profiles that encode an entire workflow.
- Profiles that tell child agents to create/merge PRs unless the role is explicitly a finisher.
- Profiles that tell child agents to ignore cuekit reporting instructions.
- Ambiguous descriptions that make `role: auto` hard to select.
- Project-specific rules stored in `~/.cuekit/agents` by accident.
- Copying builtin instructions wholesale when `instructions_mode: append` would be safer.
- Setting `model` without considering `agent_kind` compatibility.

## Validation

After approved writes, validate with the narrowest useful human CLI command:

```bash
cuekit agent list --cwd . --format json
```

When using MCP directly, the equivalent grouped list operation is `list` with `kind: "agent_profiles"`.

If project tests cover profile discovery or submission, run the relevant tests.

For cuekit repository changes, also run the normal project checks when source/tests changed:

```bash
bun run check
bun run typecheck
```

## Response Style

Be explicit and practical:

- Show proposed file paths.
- Explain why each profile belongs at project or user scope.
- Show exact Markdown before asking approval to write.
- Keep instructions concise but operational.
- When reviewing, separate confirmed issues from optional improvements.
