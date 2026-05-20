# Agent Profiles

Agent profiles let callers describe the child agent's role with a `role` field instead of repeating instructions in every objective. Profiles are Markdown files with frontmatter metadata and a body.

## Where profiles live

cuekit discovers profiles in three scopes and merges them by precedence:

1. **builtin** — packaged profiles: `coordinator`, `worker`, `reviewer`, `planner`, `scout`, `debugger`, `docs-writer`, `pr-finisher`, `parent`
2. **user** — `~/.cuekit/agents/*.md`
3. **project** — `<project-root>/.cuekit/agents/*.md`

Project profiles override user profiles, and user profiles override builtins. The project root is the nearest directory containing `.git`.

### Builtin profile cheatsheet

| Profile | Purpose |
|---|---|
| `worker` | General implementation worker for approved coding tasks. |
| `reviewer` | Strict code/design reviewer — correctness, tests, edge cases, simplicity. |
| `planner` | Turns requirements into concrete implementation steps. |
| `scout` | Fast codebase reconnaissance — relevant files, data flow, risks. |
| `debugger` | Systematic debugger for bugs, failing tests, unexpected behavior. |
| `docs-writer` | Documentation writer for README, guides, changelogs. |
| `coordinator` | Team coordinator for bounded delegated work. Used by `start_team_strategy`. |
| `pr-finisher` | PR creation, merge, and branch cleanup. Used by the `finisher` position. |
| `parent` | Long-lived parent development agent for cuekit-managed shared sessions. Submitted with `metadata.run_kind: "parent_session"` and `long_lived: true`. |

## Profile format

```md
---
id: reviewer
description: Review code for correctness, tests, regressions, and simplicity
agent_kind: claude-code
model: sonnet
tags:
  - review
  - quality
instructions_mode: append
---

Apply the team's local review checklist. Focus on correctness, tests, and edge cases.
```

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Used by `submit_task.role`. `auto` is reserved and invalid as a profile id. |
| `description` | required after merge | Optional in any single file, but at least one scope must define it. |
| `agent_kind` | optional | Default runtime adapter, e.g. `claude-code`, `opencode`, `jcode`, `gemini`, `pi`. |
| `model` | optional | Default model for adapters that support model selection. |
| `tags` | optional | Searchable labels (array or comma-separated). |
| `instructions_mode` | optional | `replace` (default) or `append` — see below. |

The Markdown body becomes `instructions`. A non-empty body replaces lower-scope instructions by default; set `instructions_mode: append` to concatenate.

## Schema

cuekit operates with two related schemas:

- **`AgentProfileFile`** — what is parsed from a single Markdown file. `description` is optional; `instructions` defaults to `""`.
- **`ResolvedAgentProfile`** — the final merged structure used at runtime. `description` and `instructions` are required and non-empty. Includes `sources` (the scope chain) and `file_paths` (paths in merge order).

### Scope merge rules

1. Precedence: **project > user > builtin**.
2. Frontmatter merge: shallow merge — project values override user/builtin, user overrides builtin.
3. Body / instructions:
   - Empty override body → inherit lower-scope instructions (regardless of `instructions_mode`).
   - Non-empty body + `instructions_mode: replace` (default) → replaces lower-scope instructions.
   - Non-empty body + `instructions_mode: append` → appends with a `---` separator.
4. After merge, both `description` and `instructions` must be non-empty.

### Reserved id

`"auto"` is reserved. Profile ids must not be `"auto"` — validation rejects this.

## Listing profiles

```sh
cuekit agent list
cuekit agent list --scope project --cwd /path/to/repo --include_instructions true
```

Via MCP:

```jsonc
{ "kind": "agent_profiles" }
```

## Submitting with an explicit role

```jsonc
// submit_task
{
  "objective": "Review the diff for regressions",
  "role": "reviewer",
  "cwd": "/path/to/repo"
}
```

If `agent_kind` is omitted, cuekit uses the profile's `agent_kind`. If `model` is omitted, cuekit uses the profile's `model` when present.

Explicit submit fields always win over profile defaults:

```jsonc
{
  "objective": "Review with the local reviewer profile but run in pi",
  "role": "reviewer",
  "agent_kind": "pi",
  "model": "k2p5",
  "cwd": "/path/to/repo"
}
```

## Automatic role selection (`role: "auto"`)

Use `role: "auto"` to let cuekit pick a role deterministically from the objective and context:

```jsonc
{
  "objective": "Debug the failing auth tests",
  "role": "auto",
  "cwd": "/path/to/repo"
}
```

The MVP selection is rule-based and explainable:

| Keyword hint | Selected role |
|---|---|
| finish / create / merge PR | `pr-finisher` |
| review / diff / PR | `reviewer` |
| plan / design / spec | `planner` |
| bug / debug / failing / test failure | `debugger` |
| docs / README / changelog | `docs-writer` |
| inspect / explore / understand / map | `scout` |
| fallback | `worker` |

The chosen `role` and `role_selection_reason` are stored on the task row and returned by `get_status` / `list({kind:"tasks"})`. The TUI detail pane shows role / source / model when present.

## Authoring help

The `cuekit-agent-profile-authoring` skill (bundled with cuekit) interviews you, drafts a profile, and always shows the diff before writing.

## Related

- [Team Strategies](/guides/team-strategies) — strategies compose profiles via `recommended_team`.
- [MCP Tools](/api/mcp-tools) — `submit_task` and `list({kind:"agent_profiles"})`.
- Design note: [cuekit-agent-profiles-design.md](https://github.com/takemo101/cuekit/blob/main/docs/designs/cuekit-agent-profiles-design.md).
