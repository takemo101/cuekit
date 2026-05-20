# Team Strategies

Team Strategies are **project-local playbooks** that cuekit renders into the coordinator's prompt. They tell the coordinating agent *what kind of mission this is*, *which agents and roles are recommended*, *what guardrails apply*, and *what success looks like* — without becoming a workflow engine.

::: tip Mental model
A strategy is a **development frame**, not workflow control. The coordinator still decides whether to add workers, split work, request extra review, steer blocked tasks, or escalate to a human. cuekit will **not** auto-submit workers from the recommended team skeleton.
:::

## Where strategies live

In `.cuekit.yaml`, under the top-level `strategies` map. Each key is a strategy name addressable via `start_team_strategy`.

```yaml
strategies:
  docs-polish:
    description: "Light README/docs improvements"
    intent: "Make the smallest meaning-preserving docs change with no unrelated edits."

    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
        model: k2p5
      worker:
        position: worker
        role: worker
        agent: pi
        model: k2p5
      reviewer:
        position: reviewer
        role: reviewer
        agent: claude-code
        model: sonnet
      finisher:
        position: finisher
        role: pr-finisher
        agent: claude-code
        model: sonnet
        objective: "Run final PR steps only if the parent has explicitly requested PR creation/merge."

    guardrails:
      - "Limit changes to docs only"
      - "Keep the diff minimal"
      - "Do not commit/push/PR unless the parent explicitly asks"

    success_criteria:
      - "Diff is restricted to README/docs"
      - "Meaning is preserved"
      - "Reviewer has confirmed no unrelated edits"

    checks:
      - "git diff --check"
      - "bun run check"

    autonomy:
      allow_additional_workers: true
      allow_parallel_reviewers: false
      require_reviewer: true
```

## Fields

### `description`

Short human-facing label. Shown in `cuekit list --kind strategies` and the TUI.

### `intent`

The mission-level goal. Rendered near the top of the coordinator prompt.

### `recommended_team`

A map of slot names → slot descriptors. Each slot may set `position`, `role`, `agent`, `model`, and an optional per-slot `objective`. Position controls the team lane:

| Position | Lane |
|---|---|
| `coordinator` | Orchestration only. |
| `worker` | Implementation / investigation. |
| `reviewer` | Review. |
| `finisher` | PR / release / cleanup finishing — handled by the builtin `pr-finisher` profile. |
| `observer` | Read-only monitoring. |

Unpositioned tasks are allowed for ad-hoc work but do not appear in the worker/reviewer/finisher lanes.

### `guardrails`

Bullet points rendered as **prompt constraints**. Use these for things you do not want the coordinator to do (commit/push, modify unrelated areas, escalate scope, ...).

### `success_criteria`

Semantic completion conditions the coordinator and reviewer judge. These are *not* automatically checked by cuekit — they shape the prompt and the final report.

### `checks`

Concrete commands or inspections (`bun run check`, `git diff --check`, etc.) the coordinator should run or delegate. Named `checks` rather than `validation` on purpose — they are confidence-building recommendations, not CI steps cuekit enforces.

### `autonomy`

Toggles that nudge the coordinator's behavior. All optional.

| Flag | Default | Effect when `true` |
|---|---|---|
| `allow_additional_workers` | unspecified | Coordinator may add workers beyond the recommended team. |
| `allow_parallel_reviewers` | unspecified | Coordinator may run parallel reviewers when useful. |
| `require_reviewer` | unspecified | Reviewer is required before final completion. |
| `allow_skip_checks` | unspecified | Coordinator may skip `checks` with a written reason. |

Unspecified fields are not rendered into the prompt.

## Starting a strategy

From CLI:

```sh
cuekit team start \
  --strategy docs-polish \
  --objective "tighten the install section in README.md" \
  --cwd /path/to/repo
```

From MCP:

```jsonc
// start_team_strategy
{
  "strategy": "docs-polish",
  "objective": "tighten the install section in README.md",
  "cwd": "/path/to/repo"
}
```

cuekit:

1. Resolves the strategy from the project's `.cuekit.yaml`.
2. Creates a team.
3. Spawns the **coordinator** task with a prompt rendered from `intent`, `recommended_team`, `guardrails`, `success_criteria`, `checks`, and `autonomy`.
4. Returns `team_id` and the coordinator's `task_id`.

The coordinator then uses cuekit MCP tools (`submit_team_tasks`, `wait` with `follow_new_tasks`, `steer`, `get_team_result`, `report_task_event`) to run the mission. cuekit will not auto-submit workers from the skeleton.

## Discovery

```sh
cuekit list --kind strategies --cwd /path/to/repo
```

Or via MCP:

```jsonc
{ "kind": "strategies", "cwd": "/path/to/repo" }
```

## When to author a strategy

Author a strategy when **the same mission shape repeats** across tasks in your project — for example: docs polish, dependency bump, test-flake hunt, perf investigation, release. If a mission is one-off, plain `submit_task` or `submit_team_tasks` with explicit per-task instructions is enough.

## Authoring help

The `cuekit-strategy-authoring` skill (bundled with cuekit's distribution) interviews you and proposes a focused strategy from your project's existing docs and code. It always presents the diff before writing.

## Related

- [Agent Profiles](/guides/agent-profiles) — strategies compose profiles, they don't replace them.
- [MCP Tools](/api/mcp-tools) — the `start_team_strategy` / `submit_team_tasks` / `wait` surface.
- Design note: [cuekit-team-strategies-design.md](https://github.com/takemo101/cuekit/blob/main/docs/designs/cuekit-team-strategies-design.md).
