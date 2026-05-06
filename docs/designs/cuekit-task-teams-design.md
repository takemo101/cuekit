# cuekit Task Teams Design

Status: proposed

## Summary

Task teams add a small collaboration layer on top of existing cuekit sessions and tasks. A team represents one user-level objective that may require several child-agent tasks, such as planning, implementation, review, and docs. Each team task can also carry a `position` such as `coordinator`, `worker`, `reviewer`, or `finisher` so callers and prompts can distinguish team leadership, implementation, review, and release/report-back work from specialist Agent Profiles.

The design intentionally avoids a full swarm runtime: no scheduler, no DAG, no file locking, no agent-to-agent chat, no automatic report routing, and no worktree manager in the MVP. The goal is to provide a practical Swarm-lite workflow without making cuekit's core model complex. Future coordinator report-back improvements should start as durable event summaries and guidance over `task_events`, not automatic wake/steer behavior.

## Goals

- Let callers attach related tasks to one `team_id`.
- Keep teams scoped to an existing cuekit session.
- Distinguish Agent Profile `role` from team `position`.
- Support lightweight coordinator/worker/reviewer/finisher workflows without a scheduler.
- Keep team status truthful by deriving it from member tasks instead of storing it separately.
- Support team-level status, wait, and cleanup operations.
- Allow `submit_task` to attach a new task to a team.
- Show team and position metadata in the TUI so humans can understand related tasks.
- Design Phase 2 batch submission and prompt context up front so Phase 1 APIs do not block them.

## Non-goals

- jcode-style full Swarm runtime.
- Automatic agent-to-agent collaboration.
- Direct messages, broadcasts, or channels.
- Automatic coordinator wake/resume or report routing.
- Coordinator-only permissions or hard runtime enforcement.
- Plan DAG scheduling.
- File read/write conflict detection.
- Worktree manager or automatic integration flow.
- Running-agent soft interrupts beyond existing `steer_task` behavior.
- TUI team creation or team operations in Phase 1.

## Naming

The public concept is `team`, not `swarm` or `group`.

Rationale:

- The feature is intentionally smaller than jcode Swarm.
- `team` accurately describes the intended workflow: related tasks under one objective with optional coordinator/worker/reviewer/finisher positions.
- It avoids implying automatic conflict resolution or autonomous spawning.

Internal names should use `TaskTeam` / `task_teams` for clarity.

`role` remains the existing Agent Profile field (`planner`, `worker`, `reviewer`, `debugger`, `pr-finisher`, etc.). `position` is the task's place inside a team (`coordinator`, `worker`, `reviewer`, `finisher`, or `observer`).

Example:

```json
{
  "team_id": "tm_123",
  "role": "planner",
  "position": "coordinator",
  "objective": "Coordinate the implementation and summarize worker outputs"
}
```

This means: use the `planner` Agent Profile, but act as the team's coordinator.

## Phase Overview

### Phase 1: Manual task teams

Phase 1 provides the durable team primitive and operations over existing tasks.

Included:

- `create_team`
- `list_teams`
- `get_team_status`
- `submit_task({ team_id, position })`
- `wait_team`
- `cleanup_team`
- TUI display-only team and position metadata

Tasks are added manually by passing `team_id` to `submit_task`. `position` is optional but recommended for team tasks. Missing position is not a hard error because ambiguous ad-hoc tasks are valid in Swarm-lite workflows. Phase 2 `submit_team_tasks` should surface a warning because unpositioned tasks do not appear in coordinator/worker/reviewer/finisher/observer lanes.

### Phase 2: Batch team task submission and prompt context

Phase 2 adds the minimum collaboration behavior needed for the feature to feel like Swarm-lite while staying simple.

Included:

- `submit_team_tasks`
- team-position aware batch submission
- lightweight team context prompt injection
- coordinator prompt guidance for using existing MCP tools such as `get_team_status`, `wait_team`, `get_task_result`, `steer_task`, and `submit_team_tasks`
- coordinator prompt guidance to assign `position` when the lifecycle lane is known (`worker` for implementation/investigation, `reviewer` for review, `finisher` for PR/release/cleanup finishing, `observer` for monitoring, and `coordinator` only for orchestration)
- coordinator runtime guidance: choose the caller/orchestrator runtime or an equivalent MCP-capable runtime

This keeps `create_team` simple and makes adding more tasks to an existing team natural. Coordinator behavior remains prompt-guided, not runtime-enforced.

### Future phases

Potential later work:

- team-level result summaries
- TUI team cockpit: Teams mode, team list/detail, lanes, attention, member task selection, and normal per-task attach-and-return from team detail
- team create/wait/cleanup actions in TUI
- team messages or coordinator notes
- semi-automatic strategy slot materialization: generate a coordinator-facing `submit_team_tasks` skeleton from `.cuekit.yaml` `recommended_team` slots without auto-submitting tasks
- lightweight conflict hints from declared scopes or git diff
- optional worktree grouping

Coordinator-led dogfood follow-ups (2026-05-04):

- Dynamic team waiting: default `wait_team` remains snapshot-based, but coordinator-led workflows can use `follow_new_tasks` so waits include workers/reviewers created by the coordinator after the wait begins.
- Coordinator prompt guidance: coordinator tasks should get a concise recipe for using cuekit tools to submit workers, wait with bounded polling, request review, steer stalled work, and report a final team summary. This is prompt guidance only, not scheduler enforcement.
- Team result/timeline: parents need an event-first team result view that highlights coordinator, worker, reviewer, and finisher terminal reports without reading noisy runtime transcripts.
- Empty team deletion: `cleanup_team` removes terminal tasks but intentionally keeps the team row; add an explicit empty-team deletion policy/operation.
- Steering surface review: `steer_team` is useful for broadcasting one instruction to all non-terminal team tasks. Before API stabilization, decide whether to keep `steer_task`/`steer_team` or introduce a grouped `steer({ kind })` operation.
- Event-first display: team summaries should prefer durable `task_events`; transcript tails remain useful for task detail/debugging, but TUI/transcript noise should not be the primary team result surface.

Implementation plan: [Coordinator-Led Team Improvements](../plans/2026-05-04-coordinator-led-team-improvements-plan.md).

These are not part of Phase 1 or Phase 2.

## Data Model

### `task_teams`

```sql
create table task_teams (
  id text primary key,
  session_id text not null,
  title text not null,
  objective text,
  created_at text not null,
  updated_at text not null,
  metadata_json text,
  foreign key(session_id) references sessions(id) on delete cascade
);

create index idx_task_teams_session_id on task_teams(session_id);
create index idx_task_teams_updated_at on task_teams(updated_at);
```

Notes:

- `status` is not stored.
- Teams are session-scoped.
- `metadata_json` is optional escape-hatch storage for future UI or caller metadata.
- Session deletion cascades to teams.

### `tasks.team_id` and `tasks.team_position`

```sql
alter table tasks add column team_id text references task_teams(id) on delete set null;
alter table tasks add column team_position text;
create index idx_tasks_team_id on tasks(team_id);
```

Notes:

- A task may belong to zero or one team.
- A team may have zero or more tasks.
- `team_position` is stored separately from Agent Profile `role` to avoid semantic confusion.
- The public API field is `position`; the store column may use `team_position` for clarity.
- Valid positions are `coordinator`, `worker`, `reviewer`, `finisher`, and `observer`.
- `position` should normally be present only when `team_id` is present. If a caller provides `position` without `team_id`, return `invalid_input`.
- Deleting a team requires the team to be empty. Use `cleanup_team` / task deletion first, then `team delete` or grouped `delete({ kind: "team" })`.
- Task deletion naturally removes that task from aggregate team status.

## Team Positions

`position` describes a task's place inside a team. It is not an Agent Profile.

```ts
type TeamPosition = "coordinator" | "worker" | "reviewer" | "finisher" | "observer";
```

Recommended meaning:

- `coordinator`: leads the team, checks team status/results, steers workers when needed, and produces integration summaries.
- `worker`: completes a scoped implementation/research/docs task.
- `reviewer`: reviews combined team output or a specific team member's output.
- `finisher`: owns the final release/report-back lane after implementation and review, such as PR completion or durable coordinator notification routing. A finisher is not a reviewer; it should be grouped separately in status and run summaries.
- `observer`: watches or reports without owning implementation.

Cuekit does not enforce special permissions for positions in Phase 1/2. A coordinator is a normal cuekit task with coordinator-oriented metadata and prompt context. If its runtime has MCP access, it can use existing tools to inspect the team and steer workers; cuekit does not automatically wake it, route reports to it, or require workers to obey it. A finisher is likewise a normal task with finisher-oriented metadata; durable notification/report-back designs should build on its `position: finisher` events before adding any automatic wake or steering behavior.

A coordinator should normally use the same coding-agent runtime as the caller/orchestrator, or at least a runtime with equivalent cuekit MCP access. In dogfood runs where only the caller's runtime has cuekit MCP configured, the coordinator should use that same runtime. Coordinator tasks should also normally use interactive adapter mode: coordination is multi-step, may need steering, and can stall in non-interactive batch mode. cuekit allows explicit coordinator batch mode for compatibility, but should warn callers that batch is better suited to focused worker/reviewer tasks. Workers and reviewers may use other adapters because they can complete scoped work and report results without orchestrating the team.

## Team Status Aggregation

Team status is computed from current member tasks.

Proposed type:

```ts
type TeamStatus =
  | "empty"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked"
  | "mixed";
```

Aggregation rules:

1. No tasks -> `empty`.
2. Any non-terminal task -> `running`.
3. All terminal tasks are `completed` -> `completed`.
4. All terminal tasks are `cancelled` -> `cancelled`.
5. All terminal tasks have the same failure-like status -> that status (`failed`, `timed_out`, or `blocked`).
6. Terminal statuses are mixed -> `mixed`.

Rationale:

- This keeps team status truthful and race-resistant.
- It avoids syncing denormalized status on every task update.
- `mixed` is explicit when a team contains both success and failure/cancel states.

`input_required` is non-terminal, so a team containing an `input_required` task is `running` for aggregate purposes. The detailed counts still expose `input_required`.

## Phase 1 MCP API

Tool names use pluralization conventions only where the operation itself is plural. These names are intentionally concise and do not use `task_group` publicly.

### `create_team`

Input:

```ts
{
  session_id?: string;
  cwd?: string;
  title: string;
  objective?: string;
  metadata?: Record<string, unknown>;
}
```

Rules:

- `title` is required and non-empty.
- `session_id` and `cwd` follow existing session resolution conventions.
- If `session_id` is omitted, the command resolves or creates an active session for `cwd`, consistent with `submit_task` behavior.
- `metadata` must be JSON-serializable.

Output:

```ts
{
  team_id: string;
  session_id: string;
  title: string;
  objective?: string;
  created_at: string;
  updated_at: string;
}
```

### `submit_task` extension

Input addition:

```ts
{
  team_id?: string;
  position?: TeamPosition;
}
```

Validation:

- If `team_id` is provided, the team must exist.
- The resolved task `session_id` must equal `team.session_id`.
- If the team exists but belongs to another session, return `invalid_input` with clear details.
- If `position` is provided without `team_id`, return `invalid_input`.
- If `team_id` is provided and `position` is omitted, cuekit accepts the task and leaves `team_position` null. Callers should provide `position` for team workflows.
- The stored task row persists `team_id` and optional `team_position`.

Output:

Existing `submit_task` output remains unchanged, with optional `team_id` and `position` added if useful for clients.

### `list_teams`

Input:

```ts
{
  session_id?: string;
  cwd?: string;
  limit?: number;
  cursor?: string;
}
```

Rules:

- Accept exactly one broad scope: `session_id`, `cwd`, or neither.
- `session_id` lists teams in that session.
- `cwd` lists teams in active sessions for that worktree path.
- No scope lists recent teams across sessions.
- Pagination should mirror `list_tasks` keyset patterns where practical.

Output:

```ts
{
  teams: TeamSummary[];
  has_more: boolean;
  next_cursor?: string;
}

interface TeamSummary {
  team_id: string;
  session_id: string;
  title: string;
  objective?: string;
  status: TeamStatus;
  task_counts: TeamTaskCounts;
  updated_at: string;
}
```

### `get_team_status`

Input:

```ts
{ team_id: string }
```

Output:

```ts
{
  team_id: string;
  session_id: string;
  title: string;
  objective?: string;
  status: TeamStatus;
  task_counts: TeamTaskCounts;
  positions: Record<TeamPosition, TaskSummary[]>;
  tasks: TaskSummary[];
  created_at: string;
  updated_at: string;
}

interface TeamTaskCounts {
  total: number;
  queued: number;
  running: number;
  input_required: number;
  completed: number;
  failed: number;
  cancelled: number;
  timed_out: number;
  blocked: number;
}
```

Notes:

- `tasks` should use the existing task summary shape, extended with `team_id` and `position` only if the core summary is extended.
- `positions` is a convenience grouping for clients; the same task entries also appear in `tasks`.
- The command should not refresh adapter state for every task unless existing list/status conventions already do so. Avoid making team status unexpectedly expensive.

### `wait_team`

`wait_team` is a team-scoped wrapper around `wait_tasks` semantics.

Input:

```ts
{
  team_id: string;
  mode?: "all" | "any";
  timeout_ms?: number;
  poll_interval_ms?: number;
  stop_on_failed?: boolean;
  include_results?: boolean;
  include_events?: boolean;
}
```

Rules:

- Empty team returns immediately with `status: "empty"` and no task snapshots.
- Non-empty team waits over current task IDs in the team.
- The task set is snapshotted at wait start. Tasks added later are not included in that wait call.
- If a snapshotted task is deleted during the wait, Phase 1 should intentionally match `wait_tasks` behavior and return the same `task_not_found` error rather than inventing a synthetic terminal snapshot.
- Callers should avoid concurrent cleanup/delete while a long `wait_team` is in progress, or use short bounded waits and retry.
- Output should include team status plus task snapshots.
- The same MCP timeout caveats as `wait_tasks` apply; clients should prefer bounded waits and polling.

Output shape should align with `wait_tasks`, with team metadata added:

```ts
{
  team_id: string;
  status: TeamStatus;
  mode: "all" | "any";
  done: boolean;
  timed_out: boolean;
  scope: { team_id: string; session_id?: string; cwd?: string };
  tasks: WaitTaskSnapshot[];
  error?: JobError;
}
```

Use `done`, not `completed`, to avoid drifting from `WaitTasksOutput`. The team wrapper should preserve `wait_tasks` semantics wherever possible.

### `cleanup_team`

Deletes terminal tasks in a team and leaves the team row intact.

Input:

```ts
{
  team_id: string;
  dry_run?: boolean;
}
```

Rules:

- Only terminal tasks are cleanup candidates.
- Non-terminal tasks remain untouched.
- The team remains even if all tasks are deleted.
- Empty teams return an empty deletion list, not an error.

Output:

```ts
{
  team_id: string;
  dry_run: boolean;
  deleted: Array<{ task_id: string; status: TaskStatus }>;
  remaining: TeamTaskCounts;
}
```

## Phase 2 API: Batch Submission

Phase 2 should add batch task launch without overloading `create_team`.

### Recommended API: `submit_team_tasks`

Input:

```ts
type SubmitTeamTaskItem = Omit<SubmitTaskInput, "session_id" | "team_id"> & {
  position?: TeamPosition;
};

interface SubmitTeamTasksInput {
  team_id: string;
  tasks: SubmitTeamTaskItem[];
}
```

The canonical task item schema should be derived from the existing `submit_task` input / `TaskSpec` shape. Do not maintain a parallel hand-copied schema for batch submission. The examples below may show common fields such as `objective`, `role`, `agent_kind`, `model`, `cwd`, `context`, `constraints`, `inputs`, `expected_output`, and `adapter_options`, but the implementation should follow the canonical submit-task schema.

Rules:

- `team_id` must exist.
- Every task resolves to the team's `session_id`.
- Task-level `cwd` may be accepted only if it is compatible with the team session/worktree.
- Each task item should reuse or derive from the existing `submit_task` / `TaskSpec` input shape instead of introducing a parallel schema.
- `position` is optional per task; if omitted, cuekit leaves `team_position` null.
- `context` remains the existing `TaskSpec.context` string field; Phase 2 does not change it to structured JSON.
- Task spec validation should mirror `submit_task`.
- Role resolution should mirror existing explicit/auto role behavior.
- Team context prompt injection should be applied to every accepted team task before the final child reporting contract is rendered.
- For `position: "coordinator"`, callers should select the same `agent_kind` as the caller/orchestrator when that is the only runtime known to have cuekit MCP configured. Cuekit does not verify MCP availability in Phase 2.

Output:

```ts
{
  team_id: string;
  accepted: Array<{
    index: number;
    task_id: string;
    agent_kind: string;
    role?: string;
    position?: TeamPosition;
    model?: string;
    warnings?: TeamTaskWarning[];
  }>;
  rejected: Array<{
    index: number;
    error: JobError;
  }>;
}
```

`submit_team_tasks` accepted task warnings:

- `missing_team_position`: emitted when a task is accepted without a `position`. The task is not rejected — unpositioned tasks are valid for ambiguous ad-hoc work — but callers should set a position when the lifecycle lane is known. Unpositioned tasks do not appear in coordinator/worker/reviewer/finisher/observer lanes.
- `coordinator_batch_mode`: emitted when `position: "coordinator"` is combined with `adapter_options.mode: "batch"`. Coordinator tasks are orchestration-heavy and may stall or be unsteerable in batch mode. Prefer interactive mode for coordination; use batch for focused worker/reviewer tasks.

### Role split: parent, coordinator, worker, reviewer, finisher

The intended lifecycle role split for team-based workflows:

- **parent/orchestrator**: the calling agent (e.g., the user or an upstream task). Creates the team, starts a coordinator via `start_team_strategy` or `submit_team_tasks`, then monitors via `wait_team` / `get_team_result`.
- **coordinator** (`position: coordinator`): leads the team inside the session. Uses cuekit MCP tools to submit workers/reviewers, wait for team progress (using `follow_new_tasks` where available), inspect task results, steer stalled tasks, and emit a final durable completed report.
- **worker** (`position: worker`): completes a scoped implementation, research, or docs task. Reports progress and completion through cuekit reporting; does not orchestrate the team.
- **reviewer** (`position: reviewer`): reviews combined team output or a specific worker's output. Produces concrete findings with task/file references.
- **finisher** (`position: finisher`): owns the final release/report-back lane (PR completion, durable coordinator notification). Runs after implementation/review prerequisites are satisfied. When a finisher completes, the coordinator should immediately call `get_team_result` and emit its own final completed report.

Positions are metadata, not enforcement. Cuekit does not block workers from using coordinator tools or prevent coordinators from doing implementation work. The split is prompt guidance and TUI display convention.

### Team context prompt injection

Phase 2 should inject lightweight team context into child prompts for tasks with `team_id`. This is the main Swarm-lite behavior and should remain subordinate to Agent Profile instructions and cuekit's final reporting contract.

Coordinator prompt context should say, in substance:

```text
You are the coordinator for cuekit team <team_id>: <title>.
Use cuekit MCP tools to inspect team status, wait for workers, inspect task results, submit follow-up team tasks if needed, and steer workers when they are blocked or off-scope.
You are expected to run in the same coding-agent runtime as the caller/orchestrator, or another runtime with equivalent cuekit MCP access.
Do not micromanage workers unnecessarily. Do not cleanup tasks unless explicitly requested.
```

Worker prompt context should say, in substance:

```text
You are a worker in cuekit team <team_id>: <title>.
Focus on your assigned objective. A coordinator may inspect your status/result or steer you if needed.
Report progress and completion through cuekit reporting as usual.
```

Reviewer prompt context should say, in substance:

```text
You are a reviewer in cuekit team <team_id>: <title>.
Review the relevant team outputs or final combined changes. Prefer concrete findings with task/file references.
```

Finisher prompt context should say, in substance:

```text
You are the finisher in cuekit team <team_id>: <title>.
Run only after implementation/review prerequisites are satisfied. Complete the requested finalization or report-back lane, emit durable cuekit reports with evidence, and do not create/merge PRs or cleanup tasks unless the parent/user explicitly requested that scope.
```

Observer prompt context should say, in substance:

```text
You are an observer in cuekit team <team_id>: <title>.
Monitor or summarize as requested without taking ownership of implementation.
```

If `position` is omitted, inject only generic team context:

```text
You are part of cuekit team <team_id>: <title>.
Coordinate through the parent/coordinator when necessary and report your outcome clearly.
```

This prompt context does not create new permissions. It only tells capable child agents how to use existing cuekit MCP tools when those tools are available in their runtime.

### Coordinator-to-worker guidance

Coordinators can give one worker instructions through existing `steer_task`, or broadcast one instruction to all currently non-terminal team tasks through `steer_team`, if their runtime has MCP access. Dedicated durable team messaging is still out of scope for Phase 2.

Example:

```json
{
  "task_id": "t_worker",
  "message": "Please focus only on the store migration and leave TUI changes to the other worker."
}
```

Cuekit does not automatically decide when to steer workers. The coordinator task may choose to inspect `get_team_status`, `get_task_status`, or `get_task_result`, then call `steer_task` or `steer_team` explicitly.

### Partial failure policy

Use best-effort submission with per-task results.

Rationale:

- Adapter spawn is side-effectful and cannot be made fully atomic across external CLIs.
- Some tasks may be valid while others fail model/role/adapter validation.
- Returning `accepted` and `rejected` makes retry behavior explicit.

If all tasks fail, the command still returns a structured result with an empty `accepted` list and populated `rejected` list. Catastrophic command-level errors, such as missing team or malformed input, still return the normal error envelope.

### Optional sugar later

After `submit_team_tasks` is stable, cuekit may add:

```ts
create_team({
  title: string,
  objective?: string,
  initial_tasks?: [...]
})
```

This should be implemented as sugar over `create_team` + `submit_team_tasks`, not as the primary primitive.

## TUI Design

Phase 1 TUI is display-only.

Task list:

- Show team title or compact `team_id` when space allows.
- Show `position` when space allows, distinct from Agent Profile `role`.
- Narrow terminals may omit the team/position columns.
- No team collapse/expand in Phase 1.

Task detail:

- Show `team_id`.
- Show team title if available.
- Show `position` if present.
- Optionally show aggregate team status and task counts if the data is already available without expensive extra calls.

Minimal TUI team actions:

- no create team dialog
- no wait team action
- allow cleanup of terminal tasks in the selected team after confirmation
- allow deleting an empty selected team after confirmation
- no team collapse/expand

Cleanup/delete actions should reuse the existing command layer and keep the same rules as MCP/CLI: cleanup removes terminal tasks and keeps the team row; delete requires the team to be empty.

## CLI Shape

MCP is the primary API. Human CLI can mirror grouped resource commands:

```bash
cuekit team create --title "Improve wait UX" --objective "..."
cuekit team list
cuekit team status <team-id>
cuekit team wait <team-id>
cuekit team cleanup <team-id>
```

If CLI scope gets too large, Phase 1 may expose MCP first and add human CLI aliases later. The design should not require CLI implementation before MCP support.

## Error Handling

Add `team_not_found` to `JobErrorSchema` unless implementation finds a strong reason to reuse `invalid_input`.

Expected errors:

- `team_not_found` for unknown `team_id`.
- `session_not_found` when an explicit session does not exist.
- `invalid_input` for team/session mismatch.
- `invalid_input` for malformed title, metadata, cursor, position, or duplicate input where applicable.
- Existing adapter errors remain unchanged for task submission.

Cleanup of an empty team is not an error.

## Testing Strategy

### Store tests

- create/get/list teams
- list teams by session
- task `team_id` and `team_position` persistence
- session delete cascades teams
- team delete behavior if introduced later
- task delete updates aggregate status through absence

### Core/schema tests

- team schema accepts valid summaries/status
- team status enum rejects unknown values
- task spec/status summary supports optional `team_id` and `position` if added to core shapes
- `team_not_found` error code if added

### MCP command tests

- `create_team` creates or resolves session like `submit_task`
- `list_teams` filters by session/cwd
- `get_team_status` handles empty/running/completed/failed/mixed
- `submit_task({ team_id, position })` accepts same-session team
- `submit_task({ team_id })` rejects unknown team
- `submit_task({ team_id })` rejects team/session mismatch
- `submit_task({ position })` without `team_id` rejects invalid input
- `wait_team` waits over snapshot task set
- `wait_team` handles empty team
- `cleanup_team` removes terminal tasks only and keeps team row

### TUI tests

- task list can render team and position metadata
- task detail can render team and position metadata
- narrow terminal layout does not overflow or crash

### Phase 2 tests

- `submit_team_tasks` accepts multiple valid tasks with positions
- per-task rejection for invalid role/model/agent kind/position
- best-effort behavior keeps accepted tasks when later tasks fail
- unknown team fails command-level
- task outputs include index and position for stable caller mapping
- team context prompt is injected before cuekit's final reporting contract
- coordinator prompt mentions allowed MCP inspection/steering behavior without implying automatic routing
- coordinator prompt includes explicit position guidance: worker/reviewer/finisher/coordinator lanes and that unpositioned tasks will not appear in those lanes
- accepted task without position gets `missing_team_position` warning; task is not rejected
- accepted coordinator task with batch adapter mode gets `coordinator_batch_mode` warning
- accepted tasks with worker/reviewer/finisher/observer positions get no warnings

## Compatibility and Migration

- Existing tasks have `team_id = null` and `team_position = null`.
- Existing APIs remain compatible.
- `submit_task` behavior is unchanged unless `team_id` is provided.
- Team status aggregation must tolerate historical tasks without team metadata.

## Open Questions

1. Should `list_teams` include only active-session teams by default, or all teams across sessions?
2. Should team `updated_at` bump when member tasks change, or only when team metadata changes?
   - Recommendation: do not try to sync on every task change in Phase 1; sort by team row `updated_at` and expose aggregate task activity separately later if needed.
3. Should `cleanup_team` optionally delete the team when it becomes empty?
   - Recommendation: no for Phase 1; keep team row for continuity.
4. Should Phase 2 support `role: "auto"` per submitted task?
   - Recommendation: yes, mirror `submit_task`.
5. Should `position` default from Agent Profile `role` when omitted?
   - Recommendation: no. Keep `role` and `position` independent; omission should mean unknown/unspecified team position.
6. Should coordinator tasks be required for every team?
   - Recommendation: no. Teams can be simple management containers; coordinator is recommended for Swarm-lite workflows but not required.
7. Should cuekit enforce that coordinators use an MCP-capable runtime?
   - Recommendation: no for Phase 2. Document the rule and rely on the caller to choose the caller/orchestrator runtime or an equivalent MCP-capable runtime. Automatic capability verification can be considered later.
