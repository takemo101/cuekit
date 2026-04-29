# cuekit State Model v0

> Persistence and layering constraints for this model live in [`../architecture/README.md`](../architecture/README.md).

> Minimal persistent state model for project/worktree-scoped orchestration sessions and delegated tasks.

## 1. Purpose

This document defines the minimal persistent state model for cuekit v0.

The purpose of the state model is to support:

- orchestration scoped to a project or worktree
- recovery across parent-session restarts
- delegated task tracking
- lightweight result references

This state model is intentionally minimal. It is not intended to model a full workflow engine, kanban system, event store, or knowledge graph.

---

## 2. Design Position

cuekit state is managed primarily at the **orchestration session** level.

Each orchestration session is tied to:

- a `project_root`
- a `worktree_path`
- a parent agent session reference

Delegated tasks belong to orchestration sessions.

In v0, cuekit does **not** normalize projects or worktrees into separate tables. That can be added later if cross-project querying becomes complex enough to justify it.

---

## 3. Storage Strategy

cuekit v0 uses a hybrid persistence model:

### 3.1 Global state index

A global SQLite database stores orchestration state.

Suggested location:

```text
~/.cuekit/state.db
```

### 3.2 Local result files

Task result payloads, transcripts, and other large outputs live near the worktree.

Suggested location:

```text
<worktree>/.cuekit/
```

The database stores references to these files, not the full contents.

---

## 4. Core Entities

cuekit v0 defines only two persistent entities:

1. `sessions`
2. `tasks`

This is intentionally small.

Additional entities such as `artifacts`, `projects`, `worktrees`, `task_events`, or `claims` are deferred.

---

## 5. sessions Table

### 5.1 Purpose

Represents a single orchestration run owned by a parent agent session.

### 5.2 Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | text | yes | Primary key |
| `project_root` | text | yes | Absolute project root path |
| `worktree_path` | text | yes | Absolute worktree path |
| `parent_agent_kind` | text | yes | Example: `pi`, `claude-code`, `opencode` |
| `parent_session_ref` | text | no | Native parent session identifier if available |
| `status` | text | yes | Session lifecycle status |
| `created_at` | text | yes | ISO 8601 timestamp |
| `updated_at` | text | yes | ISO 8601 timestamp |
| `ended_at` | text | no | ISO 8601 timestamp |

### 5.3 Session Status Enum

```ts
type SessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled";
```

### 5.4 Semantics

- `active` — the parent orchestration session is still managing tasks
- `completed` — the orchestration session ended successfully
- `failed` — the orchestration session ended in failure
- `cancelled` — the orchestration session was explicitly stopped

---

## 6. tasks Table

### 6.1 Purpose

Represents a delegated child task created by an orchestration session.

### 6.2 Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | text | yes | Primary key |
| `session_id` | text | yes | Foreign key to `sessions.id` |
| `parent_task_id` | text | no | Optional self-reference for simple task lineage |
| `agent_kind` | text | yes | Child runtime family |
| `model` | text | no | Requested runtime model name (e.g. `sonnet`); null if not specified at submit |
| `objective` | text | yes | Human-readable task objective |
| `status` | text | yes | Task lifecycle status |
| `native_task_ref` | text | no | Native runtime task/session reference (v0 tmux: `pane_id`) |
| `summary` | text | no | Current or final normalized summary |
| `result_ref` | text | no | Path/reference to structured result file |
| `transcript_ref` | text | no | Path/reference to transcript/log file |
| `spec_json` | text | no | JSON-encoded original `TaskSpec` for recovery, audit, and policy enforcement |
| `created_at` | text | yes | ISO 8601 timestamp |
| `updated_at` | text | yes | ISO 8601 timestamp |
| `started_at` | text | no | ISO 8601 timestamp; written on the first `queued → running` transition, preserved across later transitions |
| `completed_at` | text | no | ISO 8601 timestamp; written on the first transition into a terminal status, preserved (COALESCE) across same-state idempotent re-writes |

### 6.3 Task Status Enum

```ts
type TaskStatus =
  | "queued"
  | "running"
  | "input_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";
```

### 6.4 Semantics

- `queued` — accepted but not yet executing
- `running` — actively executing
- `input_required` — paused until steering or external input is provided
- `completed` — finished successfully enough to collect result
- `failed` — terminal error
- `cancelled` — cancelled by parent/controller
- `timed_out` — terminated by timeout policy
- `blocked` — unable to continue without external remediation

### 6.5 Notes

- `summary` may be used for either the latest normalized status summary or the final result summary
- `result_ref` and `transcript_ref` are optional because not all runtimes can guarantee both
- `parent_task_id` is sufficient for simple lineage in v0; a dedicated lineage table is not needed yet
- `native_task_ref` under the v0 tmux pane backend stores the tmux `pane_id` of the child (see adapter spec Section 3.7). The tmux session name (`cuekit-task-{task_id}`) is derivable from `id`, so it does not need its own column. v0 uses a flat 1 task = 1 tmux session layout (no window hierarchy).
- **Naming map** — the same value surfaces under three names across
  three layers (historical, kept stable for v0; reconcile in v0.2):
  - DB column: `native_task_ref` — generic so non-tmux adapters can reuse it.
  - `TaskStatusView.native_task_id` — protocol-facing field name.
  - `TaskStatusView.metadata.tmux_pane_id` — adapter-specific echo so callers operating on tmux don't have to know what "native" means.
  Operators reading `get_task_status` can treat all three as redundant projections of the same value.
- `model` stores the requested runtime model name (e.g. `sonnet` for claude-code) if the caller asked for one. Null means the adapter launched the runtime without a model flag and the runtime used its own default. See protocol spec Section 3.4.

---

## 7. Why No artifacts Table in v0

An earlier design considered a separate `artifacts` table.

That was deferred because:

- cuekit v0 should remain minimal
- many tasks only need at most one structured result and one transcript/log
- `result_ref` and `transcript_ref` cover the most common cases
- a separate 1:N artifact relation can be added later without breaking the basic model

If cuekit later needs:

- multiple output files per task
- patch + transcript + report + screenshots
- richer artifact metadata

then a dedicated `artifacts` table should be introduced. Child reports should not introduce general 1:N artifact storage until that table or an explicit artifact-list field exists; initial reports may only reference existing `result_ref` / `transcript_ref` or include small JSON payloads.


## 7.1 Child-reported results and artifacts

Once the post-v0 child reporting migration exists, canonical child-reported state should be written through cuekit operations, not by asking a child to write a `result.json` file directly. Small normalized payloads should live in `task_events.payload_json` and/or `tasks.summary`; large reports, patches, screenshots, transcripts, and logs should remain files referenced through `result_ref`, `transcript_ref`, or a future `artifacts` table.

This preserves the v0 storage rule: SQLite stores indexed state and small structured payloads, while worktree-local files store large or human-readable artifacts.


## 7.2 Post-v0 child reporting table

Child reporting is a post-v0 extension. When implemented, prefer one append-only event table over multiple task-level reporting columns or a separate `parent_notifications` table:

| Field | Type | Notes |
|---|---|---|
| `id` | text | Primary key for the event |
| `task_id` | text | Task this child report belongs to |
| `type` | text | `progress`, `completed`, `failed`, `blocked`, `help_requested`, or `log` |
| `severity` | text | Optional display/routing hint, for example `info`, `warning`, or `error` |
| `message` | text | Short human-readable summary |
| `payload_json` | text | Small structured payload; large data remains in artifact refs |
| `created_at` | text | Append timestamp |

The task row can continue to hold the latest summary/status for efficient listing, while `task_events` preserves the durable child-report inbox. Parent acknowledgement (`acked_at`) and delivery tracking are not planned unless concrete parent UX needs prove simple event listing insufficient. Terminal event types (`completed`, `failed`, `blocked`) may update `tasks.status` immediately through normal store transitions. Runtime shutdown evidence, if implemented as a separate lifecycle feature, should be stored separately from the report event and must not rewrite an explicit `failed` or `blocked` report into success.

---

## 8. Recommended SQL Schema

### 8.1 sessions

```sql
create table sessions (
  id text primary key,
  project_root text not null,
  worktree_path text not null,
  parent_agent_kind text not null,
  parent_session_ref text,
  status text not null,
  created_at text not null,
  updated_at text not null,
  ended_at text
);
```

### 8.2 tasks

```sql
create table tasks (
  id text primary key,
  session_id text not null,
  parent_task_id text,
  agent_kind text not null,
  model text,
  objective text not null,
  status text not null,
  native_task_ref text,
  summary text,
  result_ref text,
  transcript_ref text,
  spec_json text,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text,
  foreign key(session_id) references sessions(id)
);
```

### 8.3 task_events (post-v0 child reporting)

This table is deferred from the minimal v0 schema, but it is the preferred first schema addition for child reporting:

```sql
create table task_events (
  id text primary key,
  task_id text not null,
  type text not null,
  severity text,
  message text,
  payload_json text,
  created_at text not null,
  foreign key(task_id) references tasks(id)
);
```

---

## 9. Recommended Indexes

Suggested indexes for v0:

```sql
create index idx_sessions_project_root on sessions(project_root);
create index idx_sessions_worktree_path on sessions(worktree_path);
create index idx_sessions_status on sessions(status);

create index idx_tasks_session_id on tasks(session_id);
create index idx_tasks_parent_task_id on tasks(parent_task_id);
create index idx_tasks_status on tasks(status);
create index idx_tasks_agent_kind on tasks(agent_kind);

-- post-v0 child reporting
create index idx_task_events_task_id on task_events(task_id);
create index idx_task_events_created_at on task_events(created_at);
```

These are enough for:

- finding active sessions for a worktree
- listing tasks for a session
- querying running or blocked tasks
- listing child report events once child reporting is enabled
- grouping delegated work by target agent kind

---

## 10. Lifecycle Rules

### 10.1 Session lifecycle

Typical session lifecycle:

```text
active -> completed
active -> failed
active -> cancelled
```

### 10.2 Task lifecycle

Typical task lifecycle:

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> cancelled
queued -> running -> timed_out
queued -> running -> blocked
```

### 10.3 Completion semantics

- when all required delegated work is done, the parent may mark the session `completed`
- if the parent stops intentionally, it may mark the session `cancelled`
- if the orchestration process cannot continue coherently, it may mark the session `failed`

---

## 11. File Layout Recommendation

### 11.1 Global state

```text
~/.cuekit/
  state.db
```

### 11.2 Per-worktree outputs

```text
<worktree>/.cuekit/
  tasks/
    <task-id>/
      transcript.txt   # tmux pipe-pane capture of the child's session
      result.json      # runtime-emitted normalized result, if any
      exit-code        # `cuekit_exit=<n>` written by the wrapped
                       # launch command on child exit
```

Each task gets its own subdirectory so transcript, result, and the
exit-code sentinel travel together and can be deleted as a unit.

The **exit-code sentinel** is what lets cuekit distinguish a clean
child exit (`completed`) from a runtime crash (`failed`). The pane
backend wraps the adapter's launch command with a POSIX-sh trailer
`( <cmd> ) ; printf 'cuekit_exit=%d\n' "$?" > exit-code`, so the
child's real exit code lands on disk after the host shell exits. The shared pane-backed adapter wrapper reads this on pane-death detection. When no child-reported
terminal event exists, they map exit 0 to `completed` and non-zero to
`failed`. When a post-v0 child terminal event already updated task status,
the exit code is runtime-shutdown evidence rather than the canonical child
result. Exit code 0 should not rewrite an explicit `failed` / `blocked`
report into `completed`; non-zero or missing evidence after a prior
`completed` report may be surfaced as a separate runtime/shutdown warning or
transport error according to adapter policy. When no child-reported terminal
event exists, a missing sentinel (the host shell was SIGKILL'd before it
could write) is treated as `failed` with a "without writing exit code"
summary.

This keeps the persistent index global while storing large outputs
close to the actual worktree. Operators can delete `<worktree>/.cuekit/`
to remove local task artifacts for a workspace. This does not delete
task/session history from the global DB; DB cleanup must use cuekit
management operations.

---

## 12. Recovery Model

cuekit should be able to recover enough state after a parent restart to continue or inspect orchestration progress.

### 12.1 Recovery requirements

At minimum, recovery should allow:

- listing active sessions for a project/worktree
- listing tasks for a session
- determining task status from persisted rows
- locating result/transcript files via refs

### 12.2 Non-goals for v0 recovery

cuekit v0 does not need:

- full event replay
- exact in-memory reconstruction of every intermediate state
- distributed lock recovery

---

## 13. Deferred Schema Concepts

The following are intentionally deferred:

- `projects` table
- `worktrees` table
- `artifacts` table
- `task_events` table until the child-reporting extension is implemented
- `claims` or file-lock tables
- capability registry tables
- retry history tables

These should only be added when concrete usage proves the simple model insufficient.

---

## 14. Design Rationale

This state model chooses simplicity over maximal normalization.

### Why sessions are the primary management unit

The orchestration logic lives in a parent agent session. That makes the orchestration session the natural root of state.

### Why project/worktree live on sessions directly

In v0, cuekit needs project/worktree scoping but does not need full cross-project normalization.

### Why tasks belong to sessions

Delegated tasks are created by orchestration sessions and should be tracked in that context.

### Why outputs are references, not embedded blobs

Large payloads such as transcripts and result files are better stored as files near the worktree and indexed by reference.

---

## 15. Recommendation

cuekit should adopt this two-table state model for v0:

- `sessions`
- `tasks`

This gives enough structure for real project/worktree-scoped orchestration without prematurely turning cuekit into a large workflow platform.
