---
name: cuekit-dogfood
description: Use when working in the cuekit repository on implementation, review, refactor, debugging, architecture investigation, or dogfooding. Prefer cuekit MCP/team/strategy delegation at appropriate times, with cuekit CLI fallback when MCP is unavailable.
---

# cuekit Dogfood

Use this skill when working inside the cuekit repository and the task involves implementation, review, refactor, debugging, architecture investigation, planning, or validating cuekit workflows.

The goal is not to force cuekit for every tiny edit. The goal is to make cuekit the default delegation substrate whenever it can improve confidence, parallelism, review quality, or dogfood feedback.

## Execution Priority

When delegation is useful, use this priority order:

1. **cuekit MCP tools** — preferred when available.
2. **cuekit CLI fallback** — use when MCP is unavailable, disconnected, missing a needed operation, or repeatedly errors.
3. **Direct work** — last resort, or for trivial changes where delegation would add noise.

Do not silently skip cuekit delegation just because MCP fails. Capture the MCP failure briefly and try the equivalent CLI command before falling back to direct work.

## When to Use cuekit

Prefer cuekit MCP/team/strategy when any of these are true:

- The task spans multiple files or packages.
- The task changes behavior, public CLI/MCP surface, schemas, adapters, store, or architecture boundaries.
- The user asks for implementation, review, refactor, debugging, strategy, team, dogfooding, or architecture compliance.
- Independent investigation/review could catch issues.
- A coordinator/worker/reviewer split would make the work safer.
- You are uncertain and need a scout/reviewer/planner perspective.

Direct work is acceptable when:

- The change is trivial and localized.
- The user explicitly asks not to delegate.
- cuekit MCP and CLI are both unavailable and the task is still safe to complete directly.
- You are only answering a simple factual question from already-visible context.

## Strategy Discovery

Before starting a non-trivial cuekit delegation, discover available strategies.

Preferred MCP:

```json
{
  "kind": "strategies",
  "cwd": "/path/to/cuekit"
}
```

Use the `cuekit_list` MCP tool with `kind: "strategies"`.

CLI fallback:

```bash
cuekit strategy list --cwd . --format json
```

If both MCP and CLI fail, read `.cuekit.yaml` and inspect the top-level `strategies:` map.

For details on one strategy, use CLI fallback if needed:

```bash
cuekit strategy show --strategy refactor --cwd . --format json
```

## Strategy Selection Guide

Choose by `description` and `intent`, not by name alone. Current common mappings:

| Work type | Preferred strategy |
|---|---|
| Architecture/design compliance review | `architecture-review` |
| Root-cause bug fix | `bugfix` |
| New focused behavior | `feature` |
| Behavior-preserving cleanup | `refactor` |
| Docs-only improvements | `docs-polish` |
| Validating cuekit MCP/team/TUI/adapters | `dogfood` |

If no strategy matches, use a single `submit_task` or create a team and submit concrete tasks manually.

## MCP Workflows

### Start a strategy-backed team

Use this when a strategy exists and coordinator-led work is useful:

```json
{
  "strategy": "feature",
  "objective": "Implement the requested change with tests and review.",
  "cwd": "/path/to/cuekit"
}
```

Call `cuekit_start_team_strategy`.

Then poll with bounded waits. For coordinator-led teams, always follow newly-created tasks:

```json
{
  "kind": "team",
  "team_id": "tm_...",
  "timeout_ms": 45000,
  "poll_interval_ms": 2000,
  "follow_new_tasks": true,
  "include_events": true
}
```

Call `cuekit_wait` repeatedly as needed.

Before final reporting, inspect the team result:

```json
{
  "team_id": "tm_..."
}
```

Call `cuekit_get_team_result`.

### Submit focused tasks into an existing team

Use `cuekit_submit_team_tasks` when you already have a team and concrete task split.

### Submit a single task

Use `cuekit_submit_task` for focused scout/reviewer/worker tasks where a full strategy team is unnecessary.

### Steering stalled work

If a task/team is running but idle or off track, use `cuekit_steer` first:

```json
{
  "kind": "team",
  "team_id": "tm_...",
  "message": "Please report current status, blockers, and next action via cuekit reporting."
}
```

Prefer steering before cancelling. If cancellation is needed, summarize why.

## CLI Fallbacks

When MCP is unavailable or failing, use CLI equivalents.

Discover:

```bash
cuekit strategy list --cwd . --format json
cuekit strategy show --strategy feature --cwd . --format json
```

Start strategy team:

```bash
cuekit team start --strategy feature --objective "..." --cwd . --format json
```

Wait:

```bash
cuekit wait target --kind team --team-id tm_... --follow-new-tasks true --timeout-ms 45000 --poll-interval-ms 2000 --format json
```

Results:

```bash
cuekit team result --team-id tm_... --format json
cuekit task result --task-id t_... --format json
```

Steer:

```bash
cuekit steer target --kind team --team-id tm_... --message "..." --format json
```

If a CLI command shape is uncertain, inspect help:

```bash
cuekit --help
cuekit team --help
cuekit task --help
cuekit strategy --help
```

## Reporting and Integration Rules

- Treat cuekit child outputs as inputs, not authoritative truth. Verify important claims before editing or finalizing.
- Always integrate findings into your own final answer.
- For implementation work, keep normal project practices: tests first for behavior changes, focused diffs, and code review before merge.
- If cuekit delegation fails, report the failure, what fallback was attempted, and whether direct work continued.
- For dogfood tasks, capture UX gaps as focused follow-up ideas rather than broad rewrites.

## Safety Rules

- Do not use cuekit to bypass user instructions.
- Do not delegate secrets or sensitive local data unless explicitly required and safe.
- Do not let strategy recommendations override explicit user intent.
- Do not cleanup or delete tasks/teams unless you understand the impact or the user asked for cleanup.
- Prefer explicit `cwd` in MCP/CLI calls so project config and strategies resolve predictably.
