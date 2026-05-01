# Agent Profiles

Agent profiles let callers describe the child agent's role with `role` instead of repeating role instructions in every objective. Profiles are Markdown files with frontmatter metadata and body instructions.

## Where profiles live

cuekit discovers profiles in three scopes and merges them by precedence:

1. **builtin** — packaged profiles (`worker`, `reviewer`, `planner`, `scout`, `debugger`, `docs-writer`)
2. **user** — `~/.cuekit/agents/*.md`
3. **project** — `<project-root>/.cuekit/agents/*.md`

Project profiles override user profiles, and user profiles override builtins. The project root is the nearest directory containing `.git`.

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

Fields:

- `id` — profile id used by `submit_task.role`; `auto` is reserved and invalid as a profile id.
- `description` — human-readable summary; required after builtin/user/project merge.
- `agent_kind` — default runtime adapter, e.g. `claude-code`, `opencode`, or `pi`.
- `model` — default model for adapters that support model selection.
- `tags` — optional list or comma-separated tags.
- `instructions_mode` — `replace` (default) or `append` when overriding a lower-scope profile.
- body — instructions injected into the child prompt before cuekit's final reporting contract.

Frontmatter is shallow-merged. Body instructions are replaced by default; set `instructions_mode: append` to append local instructions to the lower-scope body.

## Listing profiles

```sh
cuekit agent list
cuekit agent list --scope project --cwd /path/to/repo --include_instructions true
```

MCP tool: `list_agent_profiles`.

## Submitting with an explicit role

```json
{
  "objective": "Review the diff for regressions",
  "role": "reviewer",
  "cwd": "/path/to/repo"
}
```

If `agent_kind` is omitted, cuekit uses the profile's `agent_kind`. If `model` is omitted, cuekit uses the profile's `model` when present.

Explicit submit fields win over profile defaults:

```json
{
  "objective": "Review with the local reviewer profile but run in pi",
  "role": "reviewer",
  "agent_kind": "pi",
  "model": "k2p5",
  "cwd": "/path/to/repo"
}
```

## Automatic role selection

Use `role: "auto"` to let cuekit choose a role deterministically from the objective/context:

```json
{
  "objective": "Debug the failing auth tests",
  "role": "auto",
  "cwd": "/path/to/repo"
}
```

MVP selection is rule-based and explainable:

- review/diff/PR → `reviewer`
- plan/design/spec → `planner`
- bug/debug/failing/test failure → `debugger`
- docs/README/changelog → `docs-writer`
- inspect/explore/understand/map → `scout`
- fallback → `worker`

The selected `role` and `role_selection_reason` are stored on the task and returned by status/list APIs. The TUI detail pane shows role/source/model when present.
