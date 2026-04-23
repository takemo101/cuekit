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
| `target_agent_kind` | text | yes | Child runtime family |
| `objective` | text | yes | Human-readable task objective |
| `status` | text | yes | Task lifecycle status |
| `native_task_ref` | text | no | Native runtime task/session reference |
| `summary` | text | no | Current or final normalized summary |
| `result_ref` | text | no | Path/reference to structured result file |
| `transcript_ref` | text | no | Path/reference to transcript/log file |
| `created_at` | text | yes | ISO 8601 timestamp |
| `updated_at` | text | yes | ISO 8601 timestamp |
| `completed_at` | text | no | ISO 8601 timestamp |

### 6.3 Task Status Enum

```ts
type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";
```

### 6.4 Semantics

- `queued` — accepted but not yet executing
- `running` — actively executing
- `completed` — finished successfully enough to collect result
- `failed` — terminal error
- `cancelled` — cancelled by parent/controller
- `timed_out` — terminated by timeout policy
- `blocked` — unable to continue without external remediation

### 6.5 Notes

- `summary` may be used for either the latest normalized status summary or the final result summary
- `result_ref` and `transcript_ref` are optional because not all runtimes can guarantee both
- `parent_task_id` is sufficient for simple lineage in v0; a dedicated lineage table is not needed yet
- `native_task_ref` under the v0 tmux pane backend stores the tmux `pane_id` of the child (see adapter spec Section 3.7). The tmux session name (`cuekit-{session_id}`) and window name (`job-{task_id_short}`) are derivable from `session_id` and `id`, so they do not need their own columns.

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

then a dedicated `artifacts` table should be introduced.

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
  target_agent_kind text not null,
  objective text not null,
  status text not null,
  native_task_ref text,
  summary text,
  result_ref text,
  transcript_ref text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  foreign key(session_id) references sessions(id)
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
create index idx_tasks_target_agent_kind on tasks(target_agent_kind);
```

These are enough for:

- finding active sessions for a worktree
- listing tasks for a session
- querying running or blocked tasks
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
    <task-id>.result.json
    <task-id>.transcript.md
```

This keeps the persistent index global while storing large outputs close to the actual worktree.

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
- `task_events` table
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
