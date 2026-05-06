# cuekit Team Strategies Design

## Status

Draft design note.

## Problem

Task Teams work well as a durable coordination substrate: cuekit can create teams, submit tasks, wait for evolving team membership, steer tasks, collect durable events, and produce event-first team results. What is still missing is a project-local way to tell an AI coordinator:

- what kind of mission this is,
- which agents/models/roles are recommended,
- what guardrails matter for this task type,
- what success looks like, and
- which checks increase confidence before reporting completion.

A rigid workflow engine would solve repeatability, but it risks turning the coordinator into a YAML executor. cuekit should preserve coordinator autonomy and AI reasoning: the coordinator should decide whether to add workers, split work, request extra review, steer blocked tasks, or ask a human for help.

## Design Goal

Add **Team Strategies**: project-local strategy profiles that cuekit renders into coordinator guidance. A strategy is a **development frame/playbook**, not workflow control.

Strategies exist because unguided delegation can be too loose for software delivery: implementation can skip review, review can lack success criteria, and final reporting can be ambiguous. A strategy supplies shared intent, guardrails, recommended roles, and confidence checks while leaving task selection, sequencing, intervention, and final judgment with the parent/coordinator agent.

Team Strategies should:

- guide coordinator-led teams without forcing fixed steps,
- make project preferences explicit and shareable,
- recommend agents/models/roles without overriding explicit caller intent,
- provide guardrails and success criteria as prompt context,
- list recommended `checks` without turning cuekit into a CI runner, and
- keep Task Teams as Swarm-lite coordination primitives rather than a scheduler.

## Non-Goals

- No takt-style step/rule workflow engine.
- No declarative `if reviewer fails then go to implement` routing in v1.
- No automatic validation/check execution in the first slice.
- No implicit permission bypass from strategy-derived config.
- No replacement for Agent Profiles; strategies compose Agent Profiles.

## Proposed Config Shape

Strategies live in `.cuekit.yaml` as a top-level `strategies` map.

```yaml
strategies:
  docs-polish:
    description: "README/docs の軽微な改善"
    intent: "最小限の docs-only 変更を行い、意味保持と unrelated edits なしを確認する"

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
        objective: "親が PR 作成/merge を明示した場合のみ、検証とレビュー後に最終処理を行う"

    guardrails:
      - "docs-only に限定する"
      - "変更は最小限にする"
      - "commit/push/PR は親が明示するまで行わない"

    success_criteria:
      - "diff が README/docs のみに限定されている"
      - "意味が変わっていない"
      - "reviewer が unrelated edits なしを確認している"

    checks:
      - "git diff --check"
      - "bun run check"

    autonomy:
      allow_additional_workers: true
      allow_parallel_reviewers: false
      require_reviewer: true
```

### Naming: `checks`

Use `checks`, not `validation`.

Rationale:

- `validation` sounds like a mandatory workflow step or CI phase.
- `checks` is short, familiar, and neutral.
- In a strategy, checks are confidence-building recommendations for the coordinator, not cuekit-enforced steps.

Separation of meaning:

- `success_criteria`: semantic completion conditions for the AI/human to judge.
- `checks`: concrete commands or inspections the coordinator should run or delegate when appropriate.

## Field Semantics

### `description`

Short human-facing label for list/show/TUI display.

### `intent`

The mission-level goal. This should be rendered near the top of the coordinator prompt.

### `recommended_team`

Named slots for suggested participants. Slot names are project-defined (`worker`, `reviewer`, `investigator`, `frontend_reviewer`, etc.). Each slot may include:

- `position`: cuekit team position (`coordinator`, `worker`, `reviewer`, `finisher`, `observer`)
- `role`: Agent Profile id
- `agent`: adapter kind (`pi`, `claude-code`, `opencode`, `jcode`, ...)
- `model`: adapter model
- `objective`: optional slot-specific guidance
- `adapter_options`: optional explicit adapter options

The strategy does not automatically submit all slots unless a command explicitly chooses that behavior. In the first slice, the strategy primarily informs the coordinator prompt; the coordinator decides what to submit.

A strategy may include optional operational slots such as `finisher`. For PR completion or durable report-back routing, use a `finisher` slot with `position: finisher`; for PR flows set `role: pr-finisher`. The position describes the team's finalization lane and is grouped separately in team status/run summaries; the role still selects the Agent Profile instructions. The coordinator should submit this slot only when the parent/user expects PR creation, merge, sync, cleanup, or explicit final report-back after implementation and review.

Coordinator slots should normally use interactive adapter mode. A strategy may still specify `adapter_options.mode: "batch"`, and callers may explicitly override a coordinator into batch mode, but cuekit should warn because coordinator work is orchestration-heavy and batch mode can stall or be unsteerable. Batch mode remains more appropriate for focused worker/reviewer tasks.

### Semi-automatic slot materialization

To make coordinator-led teams more reliable without turning strategies into workflows, cuekit should support a coordinator-facing helper that materializes `recommended_team` slots into a `submit_team_tasks` skeleton. This is semi-automatic: cuekit prepares structured task drafts, but the coordinator reviews, edits, omits, or adds tasks before submission.

The helper should:

- include slot-derived `position`, `role`, `model`, `adapter_options`, and slot-specific `objective` where configured, mapping the strategy slot field `agent` to the submit-task field `agent_kind`,
- preserve explicit user/coordinator intent over strategy defaults,
- generate concise placeholder objectives for slots without an `objective`, derived from the team objective and slot position,
- mark optional operational slots such as `finisher` as conditional rather than automatically submitted,
- keep `position` present for slot-derived tasks so worker/reviewer/finisher lanes remain visible, and
- return data only; it must not submit tasks, schedule dependencies, route messages, or auto-wake the coordinator.

Example skeleton output:

```json
{
  "strategy": "docs-polish",
  "team_id": "tm_123",
  "tasks": [
    {
      "slot": "worker",
      "position": "worker",
      "role": "worker",
      "agent_kind": "pi",
      "model": "k2p5",
      "objective": "Apply the requested docs-only improvement with the smallest safe diff."
    },
    {
      "slot": "reviewer",
      "position": "reviewer",
      "role": "reviewer",
      "agent_kind": "claude-code",
      "model": "sonnet",
      "objective": "Review the docs-only diff for meaning preservation and unrelated edits."
    },
    {
      "slot": "finisher",
      "position": "finisher",
      "role": "pr-finisher",
      "agent_kind": "claude-code",
      "model": "sonnet",
      "objective": "Verify implementation/review prerequisites, finish the requested PR/release/report-back work, and report completion.",
      "conditional": true,
      "condition": "Submit only if the parent explicitly requested PR/release finishing."
    }
  ],
  "notes": [
    "Review and adjust objectives before calling submit_team_tasks.",
    "Do not submit conditional finisher slots unless PR/release finishing was requested."
  ]
}
```

This should be exposed as a helper/surface the coordinator can call after `start_team_strategy`, or as additional rendered strategy detail. It deliberately stops short of `start_team_strategy` auto-creating workers/reviewers; the coordinator remains responsible for task selection and final reporting.

### `guardrails`

Constraints the coordinator should preserve while planning and delegating. These are prompt guidance, not hard runtime policy.

### `success_criteria`

Completion criteria the coordinator should satisfy before final reporting.

### `checks`

Recommended confidence checks. These may be shell commands (`bun run check`) or textual checks (`reviewer confirms docs-only diff`). cuekit should render them into the coordinator prompt. Automatic execution can be considered later, but is not part of the initial design.

### `autonomy`

Hints about coordinator freedom:

```yaml
autonomy:
  allow_additional_workers: true
  allow_parallel_reviewers: true
  require_reviewer: true
  allow_skip_checks: false
```

These are guidance flags for prompt rendering. They should not become a hidden scheduler.

## Prompt Rendering

A strategy should render into the coordinator task prompt as a clear mission brief.

Example:

```text
Team strategy: docs-polish

Intent:
最小限の docs-only 変更を行い、意味保持と unrelated edits なしを確認する。

Recommended team:
- worker: position worker, role worker, agent pi, model k2p5
- reviewer: position reviewer, role reviewer, agent claude-code, model sonnet
- finisher: position finisher, role pr-finisher, agent claude-code, model sonnet

Guardrails:
- docs-only に限定する
- 変更は最小限にする
- commit/push/PR は親が明示するまで行わない

Success criteria:
- diff が README/docs のみに限定されている
- 意味が変わっていない

Checks:
- git diff --check
- bun run check

Autonomy:
- You may add additional workers when useful.
- Reviewer is required before final completion.

Use cuekit tools to coordinate: inspect the strategy's recommended team skeleton when useful, adjust it, submit_team_tasks, wait with follow_new_tasks, steer when needed, get_team_result, and report a final completed event.

When submitting team tasks, set a clear position whenever the lifecycle lane is known: worker for implementation/investigation, reviewer for review, finisher for PR/release/cleanup finishing, observer for monitoring, and coordinator only for orchestration. Unpositioned team tasks are allowed for ambiguous ad-hoc work, but they will not appear in worker/reviewer/finisher lanes.

When team status or result includes attention_items, inspect them before deciding whether to continue, submit more tasks, steer a task, or emit your final report.

After a `position: finisher` task completes, inspect the team result with get_team_result and immediately emit your own final completed report — do not wait for parent steering. If no finisher was submitted, the coordinator remains responsible for the final durable report.
```

## Resolution and Precedence

When a strategy recommends `role`/`agent`/`model`, precedence should be:

1. explicit request fields,
2. strategy `recommended_team` fields,
3. `.cuekit.yaml` `teams.roles` defaults,
4. `.cuekit.yaml` `submit` defaults,
5. validation error if no agent can be resolved.

Project-derived executable behavior must keep the existing safety rule: if config-derived role/agent defaults are used, cuekit should not silently enable permission bypass unless the caller explicitly supplies adapter options.

## CLI / MCP Surface

Initial human CLI:

```sh
cuekit strategy list
cuekit strategy show docs-polish
cuekit team start --strategy docs-polish --objective "README の wait 説明を改善"
```

Initial MCP candidate:

```json
{
  "strategy": "docs-polish",
  "objective": "README の wait 説明を改善",
  "cwd": "/repo"
}
```

The `team start` / MCP operation should:

1. resolve the strategy from project config,
2. create a team,
3. submit one coordinator task with strategy-rendered guidance,
4. return `team_id` and coordinator `task_id`, and
5. leave worker/reviewer creation to the coordinator unless explicitly requested later.

A follow-up CLI/MCP surface should expose the semi-automatic skeleton without submitting it. Possible shapes:

```sh
cuekit strategy slots docs-polish --team-id tm_123 --objective "README の wait 説明を改善" --format json
```

or grouped MCP/list detail output extending the existing strategy detail surface rather than creating a flat standalone MCP tool:

```json
{
  "kind": "strategies",
  "strategy": "docs-polish",
  "include_task_skeleton": true,
  "team_id": "tm_123",
  "objective": "README の wait 説明を改善"
}
```

The returned skeleton should be directly usable as a starting point for `submit_team_tasks`, but callers/coordinators must still decide which tasks to submit. If the grouped `cuekit_list kind=strategies` surface becomes too crowded, a human CLI helper such as `cuekit strategy slots` can share the same underlying renderer without adding a new MCP tool.

## Relationship to Existing Concepts

### Agent Profiles

Agent Profiles define expertise and role instructions. Strategies choose which profiles are recommended for a mission.

### Task Teams

Task Teams remain durable grouping/status/event/result primitives. Strategies provide a mission brief for a coordinator-led team.

### Project Config Defaults

Existing `submit` and `teams` defaults remain broad defaults. Strategies are task-type-specific recommendations.

### takt-style Workflows

takt-style workflows define executable steps and routing rules. cuekit strategies intentionally avoid that. cuekit should use strategies to increase coordinator context, not reduce coordinator reasoning.

## Open Questions

1. Should slot skeletons be exposed through `strategy show/list`, a dedicated `strategy slots` command, or a grouped MCP operation?
2. Should `checks` allow structured entries later, e.g. `{ run: "bun test", required: true }`, or remain strings for v1?
3. Should strategy `recommended_team` slots support multiple reviewers with the same position?
4. Should `strategy show` render raw config, rendered prompt, or both?
5. Should TUI expose strategy selection when creating a team?

## Suggested Implementation Slices

1. Config schema and docs for `strategies`.
2. Strategy resolver and prompt renderer.
3. `cuekit strategy list/show`.
4. `cuekit team start --strategy` that submits a coordinator with rendered strategy guidance.
5. MCP operation for starting a strategy-backed team.
6. Semi-automatic `recommended_team` slot materialization that returns a coordinator-facing `submit_team_tasks` skeleton without submitting it.
7. Dogfood with `docs-polish`, `bugfix`, and `feature` strategies.
