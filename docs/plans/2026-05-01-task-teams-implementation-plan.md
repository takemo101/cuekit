# Task Teams Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement cuekit task teams: session-scoped multi-task containers with positions, group status/wait/cleanup, TUI visibility, and Phase 2 batch team submission with prompt context.

**Architecture:** Add `task_teams` as a thin store layer and attach optional `team_id` / `team_position` metadata to tasks. MCP commands remain schema-first and reuse existing task/session behavior; team status is derived from member tasks, not stored. Phase 2 builds on Phase 1 by batch-calling the same submit path with team context prompt injection, not by introducing a separate scheduler.

**Tech Stack:** Bun, TypeScript, zod/incur schemas, SQLite migrations, cuekit MCP operation registry, OpenTUI React package, GitButler CLI.

---

## Source Design

Read before starting any task:

- `docs/designs/cuekit-task-teams-design.md`
- `docs/specs/2026-04-23-cuekit-protocol-spec.md`
- `docs/specs/2026-04-23-cuekit-state-model.md`
- `docs/architecture/design-principles.md`
- `docs/architecture/coding-rules.md`

Implementation must preserve existing task-only workflows. `team_id` and `position` are optional additions.

## Work Breakdown / GitHub Issues

Recommended issue split:

1. Core/store task teams schema and persistence
2. Team status aggregation helpers
3. MCP Phase 1 team commands: create/list/status
4. `submit_task` team attachment and validation
5. `wait_team` and `cleanup_team`
6. TUI display of team and position metadata
7. Phase 2 `submit_team_tasks` batch submission
8. Phase 2 team prompt context injection and docs validation

Each issue should be implemented as a separate PR unless the maintainer explicitly batches adjacent issues.

## File Map

### Core package

- Modify: `packages/core/src/job-error.ts` — add `team_not_found`.
- Modify: `packages/core/src/task-spec.ts` — optional `team_id` and `position` only if prompt rendering or adapter submission needs them in `TaskSpec`; otherwise keep them in submit input/store metadata.
- Modify: `packages/core/src/task-summary.ts` — add optional `team_id` and `position` for list/status/TUI summaries.
- Modify: `packages/core/src/task-status-view.ts` — add optional `team_id` and `position` if `get_task_status` exposes them.
- Create: `packages/core/src/team.ts` — `TeamPositionSchema`, `TeamStatusSchema`, `TaskTeamSchema`, `TeamSummarySchema`, `TeamTaskCountsSchema`, helpers/types.
- Modify: `packages/core/src/index.ts` — export new team types.
- Test: `packages/core/__tests__/schemas.test.ts`.

### Store package

- Create: `packages/store/src/sql/009-task-teams.sql` — `task_teams`, `tasks.team_id`, `tasks.team_position`, indexes.
- Create: `packages/store/src/task-team.ts` — raw row schema.
- Create: `packages/store/src/task-team-store.ts` — create/get/list team helpers and member listing.
- Modify: `packages/store/src/task.ts` — parse `team_id` and `team_position` nullable task columns.
- Modify: `packages/store/src/task-store.ts` — `CreateTaskInput` accepts `team_id`/`team_position`; insert/list reads them.
- Modify: `packages/store/src/index.ts` — export team store/types.
- Test: `packages/store/__tests__/migrate.test.ts`, `packages/store/__tests__/task-store.test.ts`, new `packages/store/__tests__/task-team-store.test.ts`.

### MCP package

- Create: `packages/mcp/src/team-status.ts` — aggregate team status/counts/position grouping from task rows.
- Create: `packages/mcp/src/commands/create-team.ts`.
- Create: `packages/mcp/src/commands/list-teams.ts`.
- Create: `packages/mcp/src/commands/get-team-status.ts`.
- Create: `packages/mcp/src/commands/wait-team.ts`.
- Create: `packages/mcp/src/commands/cleanup-team.ts`.
- Create: `packages/mcp/src/commands/submit-team-tasks.ts`.
- Modify: `packages/mcp/src/commands/submit-task.ts` — accept `team_id`/`position`, validate session match, pass metadata through adapter submit, inject team context when applicable.
- Modify: `packages/mcp/src/commands/list-tasks.ts` — include `team_id`/`position` in summaries.
- Modify: `packages/adapters/src/agent-adapter.ts` — extend `AdapterSubmitInput` with optional `team_id`/`team_position`.
- Modify: `packages/adapters/src/pane-adapter.ts` — persist team metadata on `createTask`, expose it from `status()` and `list()`.
- Modify: `packages/mcp/src/operations.ts` — register new MCP/CLI operations.
- Modify: `packages/mcp/__tests__/commands.test.ts` — command coverage.
- Modify: `packages/mcp/__tests__/cli.test.ts`, `packages/mcp/__tests__/mcp-stdio-integ.test.ts` — operation registration/tool list coverage.

### Adapters package

- Modify: `packages/adapters/src/task-spec-prompt.ts` — render team context before cuekit final reporting contract if stored on `TaskSpec`.
- Test: `packages/adapters/__tests__/task-spec-prompt.test.ts`.

If team context is kept out of `TaskSpec`, the submit command must render/inject it into `context` or `role_instructions` before adapter submission. Prefer a small explicit `team_context` field in `TaskSpec` if it keeps prompt rendering clearer and testable.

### TUI package

- Modify: `packages/tui/src/context.ts` — add optional team lookup callback only if detail needs title/status.
- Modify: `packages/tui/src/data.ts` — load/propagate `team_id`/`position` from summaries/status after MCP/list/status producers expose them.
- Modify: `packages/tui/src/components/task-list.tsx` — show team/position when width allows.
- Modify: `packages/tui/src/components/task-detail.tsx` — show team/position metadata.
- Test: `packages/tui/__tests__/tui-data.test.ts`, `packages/tui/__tests__/tui-smoke.test.ts`, `packages/tui/__tests__/task-detail.test.ts`.

### Docs

- Modify: `docs/designs/cuekit-task-teams-design.md` if implementation decisions differ.
- Optionally create: `docs/guides/task-teams.md` after Phase 2 is implemented.

---

## Chunk 1: Core and Store Foundation

### Task 1: Core/store task teams schema and persistence

**GitHub issue title:** `Add task teams store schema and core types`

**Files:**
- Create: `packages/core/src/team.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/job-error.ts`
- Modify: `packages/core/src/task-summary.ts`
- Modify: `packages/core/src/task-status-view.ts`
- Create: `packages/store/src/sql/009-task-teams.sql`
- Create: `packages/store/src/task-team.ts`
- Create: `packages/store/src/task-team-store.ts`
- Modify: `packages/store/src/task.ts`
- Modify: `packages/store/src/task-store.ts`
- Modify: `packages/store/src/index.ts`
- Test: `packages/core/__tests__/schemas.test.ts`
- Test: `packages/store/__tests__/migrate.test.ts`
- Test: `packages/store/__tests__/task-store.test.ts`
- Test: `packages/store/__tests__/task-team-store.test.ts`

- [ ] **Step 1: Write failing core schema tests**

Add tests that assert:

- `TeamPositionSchema` accepts `coordinator`, `worker`, `reviewer`, `observer`.
- `TeamStatusSchema` accepts `empty`, `running`, `completed`, `failed`, `cancelled`, `timed_out`, `blocked`, `mixed`.
- `TaskSummarySchema` accepts optional `team_id` and `position`.
- `TaskStatusViewSchema` accepts optional `team_id` and `position`.
- `JobErrorCodeSchema` accepts `team_not_found`.

Run:

```bash
bun test packages/core/__tests__/schemas.test.ts --grep "Team"
```

Expected: FAIL because schemas do not exist yet.

- [ ] **Step 2: Implement core team types**

Create `packages/core/src/team.ts` with zod schemas and exported types:

```ts
import { z } from "zod";
import { TaskSummarySchema } from "./task-summary.ts";

export const TeamPositionSchema = z.enum(["coordinator", "worker", "reviewer", "observer"]);
export type TeamPosition = z.infer<typeof TeamPositionSchema>;

export const TeamStatusSchema = z.enum([
  "empty",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
  "mixed",
]);
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

export const TeamTaskCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  input_required: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  timed_out: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type TeamTaskCounts = z.infer<typeof TeamTaskCountsSchema>;

export const TaskTeamSchema = z.object({
  team_id: z.string().min(1),
  session_id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TaskTeam = z.infer<typeof TaskTeamSchema>;

export const TeamSummarySchema = TaskTeamSchema.extend({
  status: TeamStatusSchema,
  task_counts: TeamTaskCountsSchema,
});
export type TeamSummary = z.infer<typeof TeamSummarySchema>;
```

Also:

- export from `packages/core/src/index.ts`
- add `team_not_found` to `JobErrorCodeSchema`
- add `team_id?: string` and `position?: TeamPositionSchema` to task summary/status view schemas

- [ ] **Step 3: Run core tests**

```bash
bun test packages/core/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing migration/store tests**

Add migration tests for:

- `task_teams` table exists.
- `tasks.team_id` and `tasks.team_position` columns exist.
- `idx_task_teams_session_id`, `idx_task_teams_updated_at`, `idx_tasks_team_id` exist.
- session deletion cascades task teams.

Add store tests for:

- creating a team returns parsed row.
- getting unknown team returns null.
- listing teams by session returns only that session.
- creating a task with `team_id` and `team_position` persists both.
- `position` without `team_id` is rejected at command layer later, not by store.

Run:

```bash
bun test packages/store/__tests__/migrate.test.ts packages/store/__tests__/task-team-store.test.ts packages/store/__tests__/task-store.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Implement migration and store helpers**

Create `009-task-teams.sql`:

```sql
create table if not exists task_teams (
  id text primary key,
  session_id text not null,
  title text not null,
  objective text,
  metadata_json text,
  created_at text not null,
  updated_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

create index if not exists idx_task_teams_session_id on task_teams(session_id);
create index if not exists idx_task_teams_updated_at on task_teams(updated_at);

alter table tasks add column team_id text references task_teams(id) on delete set null;
alter table tasks add column team_position text;
create index if not exists idx_tasks_team_id on tasks(team_id);
```

If SQLite duplicate-column migration handling is needed, follow the existing migration pattern in `packages/store/src/migrations.ts` / migration tests.

Create focused store functions:

```ts
createTaskTeam(db, input)
getTaskTeamById(db, id)
listTaskTeamsBySession(db, session_id)
listTaskTeams(db, filter)
listTasksByTeam(db, team_id)
```

Update `TaskSchema`, `CreateTaskInput`, and `createTask` insert SQL to include nullable `team_id` / `team_position`.

- [ ] **Step 6: Run store tests**

```bash
bun test packages/store/__tests__/migrate.test.ts packages/store/__tests__/task-team-store.test.ts packages/store/__tests__/task-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package checks**

```bash
bun run typecheck
bun test packages/core/__tests__/schemas.test.ts packages/store/__tests__/migrate.test.ts packages/store/__tests__/task-team-store.test.ts packages/store/__tests__/task-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
but stage packages/core/src/team.ts packages/core/src/index.ts packages/core/src/job-error.ts packages/core/src/task-summary.ts packages/core/src/task-status-view.ts packages/core/__tests__/schemas.test.ts task-teams-core-store
but stage packages/store/src/sql/009-task-teams.sql packages/store/src/task-team.ts packages/store/src/task-team-store.ts packages/store/src/task.ts packages/store/src/task-store.ts packages/store/src/index.ts packages/store/__tests__/migrate.test.ts packages/store/__tests__/task-store.test.ts packages/store/__tests__/task-team-store.test.ts task-teams-core-store
but commit task-teams-core-store --only -m "Add task team store schema" --status-after
```

---

## Chunk 2: Phase 1 MCP Operations

### Task 2: Team status aggregation helpers

**GitHub issue title:** `Add task team status aggregation helpers`

**Files:**
- Create: `packages/mcp/src/team-status.ts`
- Test: `packages/mcp/__tests__/team-status.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Test cases:

- empty task list -> `empty`
- queued/running/input_required present -> `running`
- all completed -> `completed`
- all cancelled -> `cancelled`
- all failed -> `failed`
- completed + failed -> `mixed`
- positions grouping separates `coordinator`, `worker`, `reviewer`, `observer`, and omits/keeps unspecified according to chosen output shape

Run:

```bash
bun test packages/mcp/__tests__/team-status.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement aggregation helpers**

Create helpers such as:

```ts
aggregateTeamStatus(tasks: Task[]): TeamStatus
countTeamTasks(tasks: Task[]): TeamTaskCounts
groupTasksByPosition(tasks: TaskSummary[]): Record<TeamPosition, TaskSummary[]>
buildTeamSummary(team, tasks): TeamSummary
```

Keep this file pure: no database reads except types passed into the functions.

- [ ] **Step 3: Run tests**

```bash
bun test packages/mcp/__tests__/team-status.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
but stage packages/mcp/src/team-status.ts packages/mcp/__tests__/team-status.test.ts task-teams-status
but commit task-teams-status --only -m "Add task team status aggregation" --status-after
```

### Task 3: MCP create/list/status team commands

**GitHub issue title:** `Add MCP create/list/status commands for task teams`

**Files:**
- Create: `packages/mcp/src/commands/create-team.ts`
- Create: `packages/mcp/src/commands/list-teams.ts`
- Create: `packages/mcp/src/commands/get-team-status.ts`
- Modify: `packages/mcp/src/operations.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`
- Test: `packages/mcp/__tests__/mcp-stdio-integ.test.ts`

- [ ] **Step 1: Write failing command tests**

In `commands.test.ts`, add tests:

- `create-team` auto-creates/reuses session from cwd.
- `create-team` with explicit session works.
- `create-team` rejects empty title.
- `list-teams` returns teams across all sessions.
- `list-teams` filters by session/cwd.
- `list-teams` returns `has_more` and `next_cursor` when more rows exist beyond `limit`.
- `list-teams` accepts `cursor` and returns the next page without duplicates.
- `get-team-status` returns `empty` for a team with no tasks.
- `get-team-status` returns `team_not_found` for unknown ID.

In `cli.test.ts`, assert operation registry includes unique MCP names for:

- `create_team`
- `list_teams`
- `get_team_status`

In stdio integration, assert `tools/list` includes the new MCP tools.

Expected failure: commands/operations do not exist.

- [ ] **Step 2: Implement command schemas and runners**

Follow patterns from `submit-task.ts`, `list-tasks.ts`, and `get-task-status.ts`.

Rules:

- `create_team` resolves session like `submit_task`.
- IDs should use a stable prefix such as `tm_`.
- `list_teams` supports `session_id`, `cwd`, `limit`, and `cursor` with keyset pagination mirroring `list_tasks`. Do not expose a `cursor` input unless it is implemented and tested.
- `get_team_status` reads team, reads member tasks, derives status/counts/positions.

- [ ] **Step 3: Register operations**

Add to `CUEKIT_OPERATIONS` with CLI paths:

```ts
["team", "create"]
["team", "list"]
["team", "status"]
```

MCP names:

```ts
create_team
list_teams
get_team_status
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "team"
bun test packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
but stage packages/mcp/src/commands/create-team.ts packages/mcp/src/commands/list-teams.ts packages/mcp/src/commands/get-team-status.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts packages/mcp/__tests__/mcp-stdio-integ.test.ts task-teams-mcp-status
but commit task-teams-mcp-status --only -m "Add task team status commands" --status-after
```

### Task 4: `submit_task` team attachment and validation

**GitHub issue title:** `Allow submit_task to attach tasks to teams`

**Files:**
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/commands/list-tasks.ts`
- Modify: `packages/mcp/src/commands/get-task-status.ts`
- Modify: `packages/adapters/src/agent-adapter.ts`
- Modify: `packages/adapters/src/pane-adapter.ts`
- Modify: `packages/store/src/task-store.ts` if not completed in Task 1
- Modify: `packages/core/src/task-spec.ts` only if storing team metadata in `TaskSpec`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/adapters/__tests__/claude-code-adapter.test.ts`
- Test: `packages/adapters/__tests__/stub-adapters.test.ts`
- Test: `packages/store/__tests__/task-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

- `submit_task({ team_id, position })` stores task team metadata.
- output includes `team_id` and `position` if accepted.
- unknown `team_id` returns `team_not_found`.
- `position` without `team_id` returns `invalid_input`.
- team/session mismatch returns `invalid_input`.
- task-only submit without team remains unchanged.
- `list_tasks` includes `team_id` and `position` for team tasks.
- `get_task_status` includes `team_id` and `position` for team tasks.
- adapter `status()` and `list()` include team metadata from stored task rows.

- [ ] **Step 2: Implement validation**

In `SubmitTaskInputSchema`, add:

```ts
team_id: z.string().min(1).optional(),
position: TeamPositionSchema.optional(),
```

Before adapter submission:

- resolve session as today
- if `position && !team_id`, invalid input
- if `team_id`, load team
- if missing, `team_not_found`
- if `team.session_id !== session_id`, invalid input

Extend `AdapterSubmitInput` in `packages/adapters/src/agent-adapter.ts`:

```ts
export interface AdapterSubmitInput {
  spec: TaskSpec;
  session_id: string;
  team_id?: string;
  team_position?: TeamPosition;
}
```

Then update `pane-adapter.ts` so `submit()` passes `input.team_id` and `input.team_position` into `createTask`. Also update `status()` and `list()` summary/view builders to include `team_id` and public `position` from stored rows.

Do not rely on `TaskSpec.metadata` for persistence; team membership is first-class task metadata.

- [ ] **Step 3: Run tests**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "submit-task"
bun test packages/adapters/__tests__/claude-code-adapter.test.ts packages/adapters/__tests__/stub-adapters.test.ts
bun test packages/store/__tests__/task-store.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
but stage packages/mcp/src/commands/submit-task.ts packages/mcp/src/commands/list-tasks.ts packages/mcp/src/commands/get-task-status.ts packages/mcp/__tests__/commands.test.ts packages/adapters/src/agent-adapter.ts packages/adapters/src/pane-adapter.ts packages/adapters/__tests__/claude-code-adapter.test.ts packages/adapters/__tests__/stub-adapters.test.ts packages/store/src/task-store.ts packages/store/__tests__/task-store.test.ts task-teams-submit-task
but commit task-teams-submit-task --only -m "Attach submitted tasks to teams" --status-after
```

### Task 5: `wait_team` and `cleanup_team`

**GitHub issue title:** `Add wait_team and cleanup_team commands`

**Files:**
- Create: `packages/mcp/src/commands/wait-team.ts`
- Create: `packages/mcp/src/commands/cleanup-team.ts`
- Modify: `packages/mcp/src/operations.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing tests for `wait_team`**

Test:

- empty team returns immediately with `status: "empty"`, `done: true`, `tasks: []`.
- non-empty team waits until all current member tasks are terminal.
- `mode: "any"` returns when any member task is terminal.
- `stop_on_failed` mirrors `wait_tasks` behavior.
- snapshotted task deleted during wait returns `task_not_found` like `wait_tasks`.

- [ ] **Step 2: Write failing tests for `cleanup_team`**

Test:

- dry run returns terminal candidates without deleting.
- real cleanup deletes terminal team tasks.
- non-terminal team tasks remain.
- team row remains after cleanup.
- unknown team returns `team_not_found`.

- [ ] **Step 3: Implement `wait_team`**

Use existing `wait_tasks` semantics as much as possible:

- read team
- snapshot member task IDs
- call shared helper or refactor `wait-tasks.ts` so both commands use the same polling internals
- output shape uses `done`, `timed_out`, `mode`, `scope`, `tasks`, optional `error`, plus `team_id` and aggregate `status`

Avoid copy-pasting large polling logic if a small extraction is cleaner.

- [ ] **Step 4: Implement `cleanup_team`**

Follow `cleanup-tasks.ts` / `delete-task.ts` patterns:

- read team and member tasks
- filter terminal tasks
- kill orphaned tmux sessions when existing delete cleanup logic requires it
- delete terminal rows
- return counts for remaining tasks

- [ ] **Step 5: Register operations**

MCP names:

```ts
wait_team
cleanup_team
```

CLI paths:

```ts
["team", "wait"]
["team", "cleanup"]
```

- [ ] **Step 6: Run tests**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "team"
bun test packages/mcp/__tests__/cli.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
but stage packages/mcp/src/commands/wait-team.ts packages/mcp/src/commands/cleanup-team.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts task-teams-wait-cleanup
but commit task-teams-wait-cleanup --only -m "Add task team wait and cleanup" --status-after
```

---

## Chunk 3: TUI Display

### Task 6: TUI team and position display

**GitHub issue title:** `Show task team metadata in the TUI`

**Files:**
- Modify: `packages/tui/src/data.ts`
- Modify: `packages/tui/src/components/task-list.tsx`
- Modify: `packages/tui/src/components/task-detail.tsx`
- Modify: `packages/tui/src/context.ts` only if needed for team title lookup
- Test: `packages/tui/__tests__/tui-data.test.ts`
- Test: `packages/tui/__tests__/tui-smoke.test.ts`
- Test: `packages/tui/__tests__/task-detail.test.ts`

- [ ] **Step 1: Write failing TUI data tests**

Add tests that `loadTaskList` and `loadTaskDetail` preserve `team_id` and `position` from task summaries/status views.

- [ ] **Step 2: Write failing rendering smoke tests**

Assert task list/detail source renders team/position labels and remains width-aware. Keep tests similar to existing TUI smoke tests; avoid brittle snapshots.

- [ ] **Step 3: Implement data propagation**

Ensure `team_id` and `position` move through TUI data structures without requiring extra MCP calls. If team title is not already present, display compact `team_id` in Phase 1.

- [ ] **Step 4: Implement list/detail rendering**

Task list:

- Show `position` when width allows.
- Show compact `team_id` when width allows.
- Preserve existing narrow-terminal behavior.

Task detail:

- Add metadata entries for `team` and `position`.

- [ ] **Step 5: Run tests**

```bash
bun test packages/tui/__tests__/tui-data.test.ts packages/tui/__tests__/tui-smoke.test.ts packages/tui/__tests__/task-detail.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/tui/src/data.ts packages/tui/src/components/task-list.tsx packages/tui/src/components/task-detail.tsx packages/tui/src/context.ts packages/tui/__tests__/tui-data.test.ts packages/tui/__tests__/tui-smoke.test.ts packages/tui/__tests__/task-detail.test.ts task-teams-tui
but commit task-teams-tui --only -m "Show task team metadata in TUI" --status-after
```

---

## Chunk 4: Phase 2 Batch Submission and Prompt Context

### Task 7: `submit_team_tasks` batch submission

**GitHub issue title:** `Add submit_team_tasks batch submission`

**Files:**
- Create: `packages/mcp/src/commands/submit-team-tasks.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts` — extract reusable submit helper if needed
- Modify: `packages/mcp/src/operations.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Test: `packages/mcp/__tests__/cli.test.ts`

- [ ] **Step 1: Write failing batch submission tests**

Test:

- accepts multiple valid task items into the same team.
- returns `accepted[]` with stable `index`, `task_id`, `agent_kind`, `role`, `position`, `model` where present.
- returns `rejected[]` for invalid task items.
- best-effort behavior keeps accepted tasks when later items fail.
- unknown team returns command-level `team_not_found`.
- per-task `role: "auto"` behaves like `submit_task`.
- per-task `position` persists to the task row.

- [ ] **Step 2: Refactor submit internals carefully**

Avoid duplicating all `runSubmitTask` logic. Extract an internal helper from `submit-task.ts`, for example:

```ts
submitTaskResolved(ctx, input, overrides): Promise<SubmitTaskOutput>
```

Requirements:

- Keep public `runSubmitTask` behavior unchanged.
- Batch command should call the same validation/profile/adapter path.
- Batch command must force `team_id` to the parent input team and reject task items attempting a different team/session.

- [ ] **Step 3: Implement command output**

Output:

```ts
{
  team_id: string;
  accepted: Array<{ index: number; task_id: string; agent_kind: string; role?: string; position?: TeamPosition; model?: string }>;
  rejected: Array<{ index: number; error: JobError }>;
}
```

- [ ] **Step 4: Register operation**

MCP name:

```ts
submit_team_tasks
```

CLI path:

```ts
["team", "submit"]
```

- [ ] **Step 5: Run tests**

```bash
bun test packages/mcp/__tests__/commands.test.ts --grep "submit-team-tasks"
bun test packages/mcp/__tests__/cli.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
but stage packages/mcp/src/commands/submit-team-tasks.ts packages/mcp/src/commands/submit-task.ts packages/mcp/src/operations.ts packages/mcp/__tests__/commands.test.ts packages/mcp/__tests__/cli.test.ts task-teams-batch-submit
but commit task-teams-batch-submit --only -m "Add batch task team submission" --status-after
```

### Task 8: Team prompt context injection and docs validation

**GitHub issue title:** `Inject team context into child task prompts`

**Files:**
- Modify: `packages/core/src/task-spec.ts` if adding `team_context`
- Modify: `packages/adapters/src/task-spec-prompt.ts`
- Modify: `packages/mcp/src/commands/submit-task.ts`
- Modify: `packages/mcp/src/commands/submit-team-tasks.ts`
- Test: `packages/adapters/__tests__/task-spec-prompt.test.ts`
- Test: `packages/mcp/__tests__/commands.test.ts`
- Create: `docs/guides/task-teams.md` if user-facing docs are desired now
- Modify: `docs/README.md` if guide is added

- [ ] **Step 1: Write failing prompt renderer tests**

Test that rendered prompts include team context:

- generic team member context
- coordinator context mentions MCP access and same-runtime guidance
- worker context
- reviewer context
- context appears after Agent Profile instructions but before cuekit final reporting contract
- cuekit final reporting contract remains last

- [ ] **Step 2: Implement team context model**

Recommended `TaskSpec` addition:

```ts
team_context: z.object({
  team_id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().optional(),
  position: TeamPositionSchema.optional(),
}).optional()
```

If this is too broad, implement an internal rendered `team_instructions` string instead. Prefer structured context if it helps auditing and future prompt rendering.

- [ ] **Step 3: Inject context during submit**

In `submit_task` / `submit_team_tasks`:

- when `team_id` is present, load team
- add `team_context` to the parsed spec or render equivalent instructions
- preserve Agent Profile role instructions
- do not override child reporting contract

- [ ] **Step 4: Coordinator runtime guidance**

Coordinator prompt should include:

- expected same runtime/equivalent MCP access
- allowed inspection tools conceptually: `get_team_status`, `wait_team`, `get_task_result`, `steer_task`, `submit_team_tasks`
- do not cleanup unless explicitly requested
- do not micromanage workers

Do not implement runtime enforcement in this issue.

- [ ] **Step 5: Optional docs guide**

If creating `docs/guides/task-teams.md`, include:

- task-only workflow still works
- Phase 1 manual team flow
- Phase 2 batch flow
- recommended dogfood setup: coordinator uses caller/orchestrator runtime; workers/reviewers may use other adapters
- no automatic Swarm/DAG/conflict detection

- [ ] **Step 6: Run validation**

```bash
bun test packages/adapters/__tests__/task-spec-prompt.test.ts packages/mcp/__tests__/commands.test.ts --grep "team"
bun run typecheck
bun run test
bun run check
```

Expected:

- typecheck passes
- tests pass
- `bun run check` only shows existing Biome schema-version info and broken symlink warnings unless those have been fixed separately

- [ ] **Step 7: Final review and commit**

Request a code review focused on prompt ordering and coordinator overreach.

Then commit:

```bash
but stage packages/core/src/task-spec.ts packages/adapters/src/task-spec-prompt.ts packages/mcp/src/commands/submit-task.ts packages/mcp/src/commands/submit-team-tasks.ts packages/adapters/__tests__/task-spec-prompt.test.ts packages/mcp/__tests__/commands.test.ts docs/guides/task-teams.md docs/README.md task-teams-prompt-context
but commit task-teams-prompt-context --only -m "Inject task team context into child prompts" --status-after
```

---

## Cross-Issue Validation Checklist

Run after each PR if feasible, and definitely after Phase 1 and Phase 2 completion:

```bash
bun run typecheck
bun run test
bun run check
```

Manual MCP smoke flow after Phase 1:

```text
1. create_team({ title, cwd })
2. submit_task({ team_id, position: "worker", role: "worker", objective })
3. get_team_status({ team_id })
4. wait_team({ team_id, timeout_ms: 30000 })
5. cleanup_team({ team_id, dry_run: true })
```

Manual MCP smoke flow after Phase 2:

```text
1. create_team({ title, cwd })
2. submit_team_tasks({ team_id, tasks: [coordinator, worker, reviewer] })
3. get_team_status({ team_id })
4. coordinator task can inspect/steer if its runtime has cuekit MCP access
5. wait_team({ team_id, timeout_ms: 30000 })
```

## Notes for Implementers

- Use TDD for every issue.
- Keep team state thin; do not add scheduler or DAG logic.
- Do not make `team_id` required for existing task workflows.
- Do not let `position` replace Agent Profile `role`.
- Do not implement coordinator-only permissions in Phase 1/2.
- Prefer short bounded `wait_team` calls in MCP clients to avoid MCP request timeout.
- Use GitButler (`but`) for branch/stage/commit/PR workflows.
