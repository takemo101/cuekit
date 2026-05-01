# cuekit Task Groups Design

Status: proposed

## Summary

Task groups add a small grouping layer on top of existing cuekit sessions and tasks. A group represents one user-level objective that may require several child-agent tasks, such as planning, implementation, review, and docs. The design intentionally avoids a full swarm runtime: no scheduler, no DAG, no file locking, no agent-to-agent chat, and no worktree manager in the MVP.

The goal is to make multi-task coding workflows easier to operate without making cuekit's core model complex.

## Goals

- Let callers group related tasks under one `group_id`.
- Keep groups scoped to an existing cuekit session.
- Keep group status truthful by deriving it from member tasks instead of storing it separately.
- Support group-level status, wait, and cleanup operations.
- Allow `submit_task` to attach a new task to a group.
- Show group metadata in the TUI so humans can understand related tasks.
- Design Phase 2 batch submission up front so Phase 1 APIs do not block it.

## Non-goals

- jcode-style full Swarm runtime.
- Automatic agent-to-agent collaboration.
- Direct messages, broadcasts, or channels.
- Plan DAG scheduling.
- File read/write conflict detection.
- Worktree manager or automatic integration flow.
- Running-agent soft interrupts beyond existing `steer_task` behavior.
- TUI group creation or group operations in Phase 1.

## Naming

The public concept is `group`, not `swarm`.

Rationale:

- The feature is intentionally smaller than jcode Swarm.
- `group` accurately describes the MVP: related tasks under one objective.
- It avoids implying automatic coordination, conflict resolution, or autonomous spawning.

Internal names should use `TaskGroup` / `task_groups` for clarity.

## Phase Overview

### Phase 1: Manual task groups

Phase 1 provides the durable grouping primitive and operations over existing tasks.

Included:

- `create_group`
- `list_groups`
- `get_group_status`
- `submit_task({ group_id })`
- `wait_group`
- `cleanup_group`
- TUI display-only group metadata

Tasks are added manually by passing `group_id` to `submit_task`.

### Phase 2: Batch group task submission

Phase 2 adds a convenient way to launch several tasks into a group.

Recommended API:

- `submit_group_tasks`

This keeps `create_group` simple and makes adding more tasks to an existing group natural.

### Future phases

Potential later work:

- group-level result summaries
- TUI grouped/collapsible view
- group create/wait/cleanup actions in TUI
- group messages or coordinator notes
- lightweight conflict hints from declared scopes or git diff
- optional worktree grouping

These are not part of Phase 1 or Phase 2.

## Data Model

### `task_groups`

```sql
create table task_groups (
  id text primary key,
  session_id text not null,
  title text not null,
  objective text,
  created_at text not null,
  updated_at text not null,
  metadata_json text,
  foreign key(session_id) references sessions(id) on delete cascade
);

create index idx_task_groups_session_id on task_groups(session_id);
create index idx_task_groups_updated_at on task_groups(updated_at);
```

Notes:

- `status` is not stored.
- Groups are session-scoped.
- `metadata_json` is optional escape-hatch storage for future UI or caller metadata.
- Session deletion cascades to groups.

### `tasks.group_id`

```sql
alter table tasks add column group_id text references task_groups(id) on delete set null;
create index idx_tasks_group_id on tasks(group_id);
```

Notes:

- A task may belong to zero or one group.
- A group may have zero or more tasks.
- Deleting a group, if supported later, should set task `group_id` to null or require the group to be empty. Phase 1 does not need `delete_group`.
- Task deletion naturally removes that task from aggregate group status.

## Group Status Aggregation

Group status is computed from current member tasks.

Proposed type:

```ts
type GroupStatus =
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

- This keeps group status truthful and race-resistant.
- It avoids syncing denormalized status on every task update.
- `mixed` is explicit when a group contains both success and failure/cancel states.

`input_required` is non-terminal, so a group containing an `input_required` task is `running` for aggregate purposes. The detailed counts still expose `input_required`.

## Phase 1 MCP API

Tool names use pluralization conventions only where the operation itself is plural. These names are intentionally concise and do not use `task_group` publicly.

### `create_group`

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
  group_id: string;
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
  group_id?: string;
}
```

Validation:

- If `group_id` is provided, the group must exist.
- The resolved task `session_id` must equal `group.session_id`.
- If the group exists but belongs to another session, return `invalid_input` with clear details.
- The stored task row persists `group_id`.

Output:

Existing `submit_task` output remains unchanged, with optional `group_id` added if useful for clients.

### `list_groups`

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
- `session_id` lists groups in that session.
- `cwd` lists groups in active sessions for that worktree path.
- No scope lists recent groups across sessions.
- Pagination should mirror `list_tasks` keyset patterns where practical.

Output:

```ts
{
  groups: GroupSummary[];
  has_more: boolean;
  next_cursor?: string;
}

interface GroupSummary {
  group_id: string;
  session_id: string;
  title: string;
  objective?: string;
  status: GroupStatus;
  task_counts: GroupTaskCounts;
  updated_at: string;
}
```

### `get_group_status`

Input:

```ts
{ group_id: string }
```

Output:

```ts
{
  group_id: string;
  session_id: string;
  title: string;
  objective?: string;
  status: GroupStatus;
  task_counts: GroupTaskCounts;
  tasks: TaskSummary[];
  created_at: string;
  updated_at: string;
}

interface GroupTaskCounts {
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

- `tasks` should use the existing task summary shape, extended with `group_id` only if the core summary is extended.
- The command should not refresh adapter state for every task unless existing list/status conventions already do so. Avoid making group status unexpectedly expensive.

### `wait_group`

`wait_group` is a group-scoped wrapper around `wait_tasks` semantics.

Input:

```ts
{
  group_id: string;
  mode?: "all" | "any";
  timeout_ms?: number;
  poll_interval_ms?: number;
  stop_on_failed?: boolean;
  include_results?: boolean;
  include_events?: boolean;
}
```

Rules:

- Empty group returns immediately with `status: "empty"` and no task snapshots.
- Non-empty group waits over current task IDs in the group.
- The task set is snapshotted at wait start. Tasks added later are not included in that wait call.
- If a snapshotted task is deleted during the wait, Phase 1 should intentionally match `wait_tasks` behavior and return the same `task_not_found` error rather than inventing a synthetic terminal snapshot.
- Callers should avoid concurrent cleanup/delete while a long `wait_group` is in progress, or use short bounded waits and retry.
- Output should include group status plus task snapshots.
- The same MCP timeout caveats as `wait_tasks` apply; clients should prefer bounded waits and polling.

Output shape should be close to `wait_tasks`, with group metadata added:

```ts
{
  group_id: string;
  status: GroupStatus;
  completed: boolean;
  timed_out: boolean;
  tasks: WaitTaskSnapshot[];
}
```

### `cleanup_group`

Deletes terminal tasks in a group and leaves the group row intact.

Input:

```ts
{
  group_id: string;
  dry_run?: boolean;
}
```

Rules:

- Only terminal tasks are cleanup candidates.
- Non-terminal tasks remain untouched.
- The group remains even if all tasks are deleted.
- Empty groups return an empty deletion list, not an error.

Output:

```ts
{
  group_id: string;
  dry_run: boolean;
  deleted: Array<{ task_id: string; status: TaskStatus }>;
  remaining: GroupTaskCounts;
}
```

## Phase 2 API: Batch Submission

Phase 2 should add batch task launch without overloading `create_group`.

### Recommended API: `submit_group_tasks`

Input:

```ts
{
  group_id: string;
  tasks: Array<{
    objective: string;
    role?: string;
    agent_kind?: string;
    model?: string;
    cwd?: string;
    context?: string;
    constraints?: string[];
    inputs?: InputRef[];
    expected_output?: ExpectedOutputSpec;
    adapter_options?: Record<string, unknown>;
  }>;
}
```

Rules:

- `group_id` must exist.
- Every task resolves to the group's `session_id`.
- Task-level `cwd` may be accepted only if it is compatible with the group session/worktree.
- Each task item should reuse or derive from the existing `submit_task` / `TaskSpec` input shape instead of introducing a parallel schema.
- `context` remains the existing `TaskSpec.context` string field; Phase 2 does not change it to structured JSON.
- Task spec validation should mirror `submit_task`.
- Role resolution should mirror existing explicit/auto role behavior.

Output:

```ts
{
  group_id: string;
  accepted: Array<{
    index: number;
    task_id: string;
    agent_kind: string;
    role?: string;
    model?: string;
  }>;
  rejected: Array<{
    index: number;
    error: JobError;
  }>;
}
```

### Partial failure policy

Use best-effort submission with per-task results.

Rationale:

- Adapter spawn is side-effectful and cannot be made fully atomic across external CLIs.
- Some tasks may be valid while others fail model/role/adapter validation.
- Returning `accepted` and `rejected` makes retry behavior explicit.

If all tasks fail, the command still returns a structured result with an empty `accepted` list and populated `rejected` list. Catastrophic command-level errors, such as missing group or malformed input, still return the normal error envelope.

### Optional sugar later

After `submit_group_tasks` is stable, cuekit may add:

```ts
create_group({
  title: string,
  objective?: string,
  initial_tasks?: [...]
})
```

This should be implemented as sugar over `create_group` + `submit_group_tasks`, not as the primary primitive.

## TUI Design

Phase 1 TUI is display-only.

Task list:

- Show group title or compact `group_id` when space allows.
- Narrow terminals may omit the group column.
- No group collapse/expand in Phase 1.

Task detail:

- Show `group_id`.
- Show group title if available.
- Optionally show aggregate group status and task counts if the data is already available without expensive extra calls.

No TUI group actions in Phase 1:

- no create group dialog
- no wait group action
- no cleanup group action
- no group collapse/expand

These can be added after the MCP/store layer is stable.

## CLI Shape

MCP is the primary API. Human CLI can mirror grouped resource commands:

```bash
cuekit group create --title "Improve wait UX" --objective "..."
cuekit group list
cuekit group status <group-id>
cuekit group wait <group-id>
cuekit group cleanup <group-id>
```

If CLI scope gets too large, Phase 1 may expose MCP first and add human CLI aliases later. The design should not require CLI implementation before MCP support.

## Error Handling

Add `group_not_found` to `JobErrorSchema` unless implementation finds a strong reason to reuse `invalid_input`.

Expected errors:

- `group_not_found` for unknown `group_id`.
- `session_not_found` when an explicit session does not exist.
- `invalid_input` for group/session mismatch.
- `invalid_input` for malformed title, metadata, cursor, or duplicate input where applicable.
- Existing adapter errors remain unchanged for task submission.

Cleanup of an empty group is not an error.

## Testing Strategy

### Store tests

- create/get/list groups
- list groups by session
- task `group_id` persistence
- session delete cascades groups
- group delete behavior if introduced later
- task delete updates aggregate status through absence

### Core/schema tests

- group schema accepts valid summaries/status
- group status enum rejects unknown values
- task spec/status summary supports optional `group_id` if added to core shapes
- `group_not_found` error code if added

### MCP command tests

- `create_group` creates or resolves session like `submit_task`
- `list_groups` filters by session/cwd
- `get_group_status` handles empty/running/completed/failed/mixed
- `submit_task({ group_id })` accepts same-session group
- `submit_task({ group_id })` rejects unknown group
- `submit_task({ group_id })` rejects group/session mismatch
- `wait_group` waits over snapshot task set
- `wait_group` handles empty group
- `cleanup_group` removes terminal tasks only and keeps group row

### TUI tests

- task list can render group metadata
- task detail can render group metadata
- narrow terminal layout does not overflow or crash

### Phase 2 tests

- `submit_group_tasks` accepts multiple valid tasks
- per-task rejection for invalid role/model/agent kind
- best-effort behavior keeps accepted tasks when later tasks fail
- unknown group fails command-level
- task outputs include index for stable caller mapping

## Compatibility and Migration

- Existing tasks have `group_id = null`.
- Existing APIs remain compatible.
- `submit_task` behavior is unchanged unless `group_id` is provided.
- Group status aggregation must tolerate historical tasks without group metadata.

## Open Questions

1. Should `list_groups` include only active-session groups by default, or all groups across sessions?
2. Should group `updated_at` bump when member tasks change, or only when group metadata changes?
   - Recommendation: do not try to sync on every task change in Phase 1; sort by group row `updated_at` and expose aggregate task activity separately later if needed.
3. Should `cleanup_group` optionally delete the group when it becomes empty?
   - Recommendation: no for Phase 1; keep group row for continuity.
4. Should Phase 2 support `role: "auto"` per submitted task?
   - Recommendation: yes, mirror `submit_task`.
