# cuekit MCP API Specification v0

> MCP implementation constraints live in [`../architecture/README.md`](../architecture/README.md).

> MCP control surface for cuekit task protocol operations.

## 1. Purpose

This document specifies the Model Context Protocol (MCP) tool surface for cuekit.

cuekit is control-surface agnostic at the core, but MCP-first at the v0 reference control surface. In implementation terms, the v0 control surface should be authored as an `incur` command tree with Zod schemas, then exposed to agents through MCP tools. This means orchestrator agents, interactive sessions, and other tool-using clients should primarily interact with cuekit through MCP tools rather than through runtime-specific APIs.

The MCP surface should:

- expose cuekit tasks as stable tool operations
- hide adapter-specific runtime complexity
- preserve protocol semantics faithfully
- remain small and predictable
- share its command definitions with the cuekit CLI surface instead of maintaining separate MCP-only handlers

---

## 2. Design Goals

The cuekit MCP API is designed to be:

1. **small** — a minimal set of tools covers the full task lifecycle
2. **predictable** — each tool has clear input/output semantics
3. **portable** — orchestrators can use the same tools regardless of child runtime
4. **truthful** — capability differences are surfaced explicitly, not hidden
5. **agent-friendly** — request/response shapes are easy for coding agents to use reliably
6. **schema-driven** — command input/output schemas are defined once in Zod and reused for CLI, MCP, store decoding, and adapter normalization
7. **operator-friendly** — minimal admin / helper tools for DB hygiene and self-describing install live alongside the protocol projection, so cuekit can be operated without standing up a parallel admin surface (see §11.5 / §11.6)

---

## 2.1 Implementation Strategy

The v0 MCP implementation should use `incur` as the control-surface framework.

Implications:

- each cuekit operation is defined as an `incur` command
- command args/options/output are described with Zod schemas
- the same command definition is used for both CLI execution and MCP tool exposure
- the MCP **protocol projection** (§5–§11) must remain thin: each tool maps 1:1 to a cuekit-protocol operation, not a higher-level orchestration step
- **management** (§11.5) and **helper** (§11.6) tools may exist outside the protocol projection. They serve goal #7 (operator-friendly) without inflating the protocol surface itself; conformance clients can still ignore them and project the protocol cleanly

---

## 3. Tool Set

The v0 MCP API surface is organized into three groups. The **protocol
operations** (§5–§11) are the thin projection of cuekit's protocol
spec — adapters must support them. The **management tools** and
**helper tools** (§11.5 / §11.6) were added post-v0 and are not part
of the protocol itself; they exist so an operator can run cuekit
without standing up a separate admin CLI.

Protocol operations:

1. `submit_task`
2. `get_task_status`
3. `steer_task`
4. `get_task_result`
5. `cancel_task`
6. `list_tasks`
7. `list_adapters`

Management tools (§11.5):

8. `delete_task`
9. `delete_session`

Helper tools (§11.6):

10. `show_mcp_config`

MCP callers that want to implement a pure "cuekit protocol client"
can ignore groups 8–10.

---

## 4. Shared Types

### 4.1 Ack

```json
{
  "ok": true,
  "message": "optional human-readable message"
}
```

or

```json
{
  "ok": false,
  "error": {
    "code": "steering_unsupported",
    "message": "This runtime does not support steering for active tasks.",
    "retryable": false
  }
}
```

### 4.2 JobError

```json
{
  "code": "submit_failed",
  "message": "Failed to launch child runtime.",
  "retryable": true,
  "details": {
    "native_error": "spawn ENOENT"
  }
}
```

### 4.3 ArtifactRef

```json
{
  "kind": "transcript",
  "ref": ".cuekit/tasks/task_123/transcript.md",
  "title": "Full transcript"
}
```

---

## 5. submit_task

### 5.1 Purpose

Submit a new cuekit task to a target adapter.

### 5.2 Input

```json
{
  "agent_kind": "claude-code",
  "objective": "Implement retry logic in the API client",
  "model": "sonnet",
  "adapter_options": {
    "max_turns": 50
  },
  "context": "Focus on src/api/client.ts and related tests.",
  "constraints": [
    "Do not modify package.json",
    "Run targeted tests before completion"
  ],
  "inputs": [
    {
      "kind": "file",
      "ref": "/repo/src/api/client.ts"
    },
    {
      "kind": "file",
      "ref": "/repo/tests/api/client.test.ts"
    }
  ],
  "expected_output": {
    "format": "summary",
    "require_files_changed": true,
    "require_artifacts": true,
    "require_tests": true
  },
  "cwd": "/repo",
  "timeout_ms": 600000,
  "priority": "normal",
  "metadata": {
    "parent_task": "task-12"
  }
}
```

### 5.3 Required Fields

- `agent_kind`
- `objective`

### 5.3.1 Model and Adapter Options

- `model` is optional. If omitted, the adapter launches the runtime without a model flag and the runtime uses its own default. If the adapter declares `supports_model_selection: false`, passing `model` returns `invalid_input`. If the adapter exposes `available_models`, the value is validated against the list at submit time.
- `adapter_options` is optional and adapter-specific. The target adapter validates and translates the shape at submit time.

### 5.4 Output

Success:

```json
{
  "task_id": "task_123",
  "agent_kind": "pi",
  "accepted": true
}
```

Failure:

```json
{
  "accepted": false,
  "error": {
    "code": "submit_failed",
    "message": "Adapter could not launch target runtime.",
    "retryable": true
  }
}
```

### 5.5 Semantics

- successful submission does not imply the task is already running
- a returned `task_id` must be stable
- initial state may be `queued` or `running`

---

## 6. get_task_status

### 6.1 Purpose

Retrieve the current normalized state of a task.

### 6.2 Input

```json
{
  "task_id": "task_123"
}
```

### 6.3 Output

```json
{
  "task_id": "task_123",
  "agent_kind": "pi",
  "status": "running",
  "summary": "Editing retry logic and updating tests.",
  "progress_text": "Last observed activity: modifying src/api/client.ts",
  "created_at": "2026-04-23T10:00:00Z",
  "updated_at": "2026-04-23T10:02:00Z",
  "started_at": "2026-04-23T10:00:05Z",
  "supports_steering": true,
  "supports_attach": true,
  "attach_hint": "tmux attach-session -t cuekit-task-task_123",
  "artifacts": [
    {
      "kind": "transcript",
      "ref": ".cuekit/tasks/task_123/transcript.md"
    }
  ],
  "metadata": {
    "native_session_id": "calm-reef",
    "tmux_pane_id": "%17"
  }
}
```

### 6.4 Status Values

- `queued`
- `running`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `blocked`

### 6.5 Error Case

```json
{
  "task_id": "task_123",
  "status": "failed",
  "error": {
    "code": "status_unavailable",
    "message": "Native runtime status could not be refreshed.",
    "retryable": true
  }
}
```

---

## 7. steer_task

### 7.1 Purpose

Send a best-effort steering message to a running task.

### 7.2 Input

```json
{
  "task_id": "task_123",
  "message": "Also add exponential backoff coverage in the tests.",
  "reason": "Parent detected missing edge case"
}
```

### 7.3 Output

Success:

```json
{
  "ok": true,
  "message": "Steering message delivered."
}
```

Unsupported:

```json
{
  "ok": false,
  "error": {
    "code": "steering_unsupported",
    "message": "This adapter does not support steering for active tasks.",
    "retryable": false
  }
}
```

Invalid state:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_state",
    "message": "Cannot steer a terminal task.",
    "retryable": false
  }
}
```

### 7.4 Semantics

- steering is best-effort in v0
- adapters may only support steering for certain states
- orchestrators should inspect `supports_steering` from `get_task_status`

---

## 8. get_task_result

### 8.1 Purpose

Collect the normalized result of a terminal task.

### 8.2 Input

```json
{
  "task_id": "task_123"
}
```

### 8.3 Output

Successful completion:

```json
{
  "task_id": "task_123",
  "status": "completed",
  "summary": "Added retry logic with exponential backoff and updated the targeted tests.",
  "files_changed": [
    "src/api/client.ts",
    "tests/api/client.test.ts"
  ],
  "artifacts": [
    {
      "kind": "transcript",
      "ref": ".cuekit/tasks/task_123/transcript.md"
    },
    {
      "kind": "json",
      "ref": ".cuekit/tasks/task_123/result.json"
    }
  ]
}
```

Failed task:

```json
{
  "task_id": "task_404",
  "status": "failed",
  "summary": "The child runtime failed before making changes.",
  "files_changed": [],
  "artifacts": [
    {
      "kind": "log",
      "ref": ".cuekit/tasks/task_404/error.log"
    }
  ],
  "error": {
    "code": "runtime_crash",
    "message": "Child runtime exited unexpectedly.",
    "retryable": true
  }
}
```

### 8.4 Invalid State

If the task is not terminal:

```json
{
  "error": {
    "code": "invalid_state",
    "message": "get_task_result requires a terminal state.",
    "retryable": true
  }
}
```

---

## 9. cancel_task

### 9.1 Purpose

Cancel an active or pending task.

### 9.2 Input

```json
{
  "task_id": "task_123"
}
```

### 9.3 Output

```json
{
  "ok": true,
  "message": "Cancellation requested."
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_state",
    "message": "Task is already terminal.",
    "retryable": false
  }
}
```

### 9.4 Semantics

- cancellation is request-based, not an instant guarantee
- callers should re-check `get_task_status` after cancellation
- eventual terminal state should become `cancelled` or `failed` depending on runtime behavior and evidence

---

## 10. list_tasks

### 10.1 Purpose

List known tasks, optionally filtered. The result set is paginated
with a **keyset cursor** so page walks remain stable under concurrent
inserts (a new task arriving between page fetches cannot shift the
cursor or cause a row to be seen twice).

### 10.2 Input

```json
{
  "status": "running",
  "agent_kind": "opencode",
  "cwd": "/repo",
  "limit": 50,
  "cursor": "eyJ1IjoiMjAyNi0wNC0yNFQx…"
}
```

All fields are optional:

- **`status`**, **`agent_kind`**, **`session_id`**, **`cwd`** — filter
  predicates. `cwd` joins against the owning session's `worktree_path`.
- **`limit`** — integer in `[1, 1000]`. Default `100`. There is no
  "unbounded" sentinel; callers that need more than 1000 rows must
  page.
- **`cursor`** — opaque string returned in the previous response's
  `next_cursor`. Never hand-craft; the encoding is a cuekit-internal
  detail (currently base64url JSON of `{u, i}` — subject to change).
  Omit on the first page.

### 10.3 Output

```json
{
  "tasks": [
    {
      "task_id": "task_555",
      "agent_kind": "opencode",
      "status": "running",
      "summary": "Working on layout extraction",
      "updated_at": "2026-04-23T10:04:00Z"
    }
  ],
  "has_more": true,
  "next_cursor": "eyJ1IjoiMjAyNi0wNC0yM1Qx…"
}
```

- **`tasks`** — page, ordered newest-`updated_at` first.
- **`has_more`** — `true` when another page is available, `false` on
  the final page. Always present.
- **`next_cursor`** — opaque cursor to pass to the next call. Present
  only when `has_more` is `true`.

### 10.4 Summary Shape

Each returned task includes:

- `task_id`
- `agent_kind`
- `status`
- `summary` (optional)
- `updated_at`

### 10.5 Pagination Semantics

Rows are walked in `(updated_at DESC, id ASC)` order. The keyset
predicate `(updated_at, id) < (cursor_u, cursor_i)` gives these
guarantees:

- A **new row inserted between page fetches** cannot shift the
  current walk — it can only appear on a fresh page-1 request, and
  existing page anchors remain valid.
- The `id` tiebreaker handles ms-precision timestamp collisions on
  rapid inserts without skipping or duplicating rows.

---

## 11. list_adapters

### 11.1 Purpose

Describe installed or available adapters and their capabilities.

### 11.2 Input

```json
{}
```

### 11.3 Output

```json
{
  "adapters": [
    {
      "agent_kind": "pi",
      "supports_steering": true,
      "supports_attach": true,
      "supports_model_selection": false,
      "supports_artifacts": true,
      "supports_live_progress": false
    },
    {
      "agent_kind": "claude-code",
      "supports_steering": true,
      "supports_attach": true,
      "supports_model_selection": true,
      "available_models": ["haiku", "sonnet", "opus"],
      "supports_artifacts": true,
      "supports_live_progress": false
    },
    {
      "agent_kind": "opencode",
      "supports_steering": true,
      "supports_attach": true,
      "supports_model_selection": true,
      "supports_artifacts": true,
      "supports_live_progress": false
    }
  ]
}
```

All three MVP adapters ride on the v0 tmux pane backend (see adapter spec Section 3.7), so `supports_attach` is `true` across the board. `get_task_status` surfaces an `attach_hint` such as `tmux attach-session -t cuekit-task-{task_id}` that a user can run to drop directly into the live child pane.

`available_models` is only surfaced when the adapter can enumerate its models reliably (e.g. claude-code). Adapters that cannot (or choose not to) publish a list omit the field; callers should then pass `model` at their own risk and handle `submit_failed` if the runtime rejects it. cuekit does not synthesize a default on the caller's behalf.

### 11.4 Semantics

This tool is intended for:

- orchestrator planning
- runtime feature discovery
- graceful degradation when a capability is missing

---

## 11.5 Management Tools

These tools mutate cuekit's own persistence rather than the protocol
state of a task. They exist so operators can keep the DB tidy without
standing up a separate admin CLI; conformance implementations that
project only cuekit's protocol may omit them.

### 11.5.1 delete_task

Remove a terminal task row. Tasks in non-terminal states
(`queued`, `running`, `input_required`, `blocked`) are refused with
`invalid_state` — the caller cancels first.

**Input**

```json
{ "task_id": "task_555" }
```

**Output**

Ack (§4.1). On success:

```json
{ "ok": true, "message": "deleted task 'task_555'" }
```

**Side-effects**

- Removes the task row.
- Does **not** touch on-disk artifacts (`.cuekit/tasks/<id>/`).
  Operators that want full cleanup remove the directory themselves.

### 11.5.2 delete_session

Remove a session and all of its tasks in one transaction. Every child
task must already be terminal; any active task blocks the delete with
`invalid_state` so a single call can't drop live work.

**Input**

```json
{ "session_id": "session_777" }
```

**Output**

Ack (§4.1). On success:

```json
{ "ok": true, "message": "deleted session 'session_777' and 4 task(s)" }
```

**Side-effects**

- Cascades child-task deletion in a single SQLite transaction.
- Does **not** touch on-disk artifacts.

**Note on session status**: cuekit does not check the session's own
status (`active` / `completed` / `failed` / `cancelled`) before
deleting. Only **child task terminality** is the gate. An `active`
session with all-terminal tasks is deletable. This is intentional
in v0 — session lifecycle is managed implicitly and an explicit
"end session" op is not part of the v0 surface.

### 11.5.3 Post-terminal mutability

Adapters and the control surface may continue to write certain
fields on a task **after** it reaches a terminal status:

- `transcript_ref`, `result_ref` — adapters may flush late artifacts
  (transcript tail, runtime-emitted result file).
- `summary` — adapters may refine the human-readable summary.
- `updated_at` — bumps on any field write.

What stays **immutable** post-terminal:

- `status` — once terminal, never transitions to anything else.
  cuekit's state-machine validator (`validateTaskTransition`) treats
  same-state writes as no-ops (idempotent — see §13.1 and the race
  protection in pane-adapter `status()`), but cross-terminal flips
  (`completed → failed`) are defects and throw.
- `completed_at` — first terminal write wins via SQL `COALESCE`.
- `started_at`, `created_at` — never updated post-creation.

---

## 11.6 Helper Tools

### 11.6.1 show_mcp_config

Emit the MCP-server stanza an operator pastes into a client config
(Claude Code / Claude Desktop / Cursor all share the `mcpServers`
shape). Side-effect free: never writes files, never shells out.
Callable via MCP itself as a self-describing install helper.

**Input**

```json
{ "name": "cuekit", "bin": "/usr/local/bin/cuekit" }
```

Both fields optional. Defaults: `name = "cuekit"`,
`bin = "cuekit"` (relies on PATH).

**Caveat for pre-v0.1 / development installs**: cuekit isn't yet
published to a package registry, so the default `bin = "cuekit"`
assumes an operator has linked the binary onto PATH manually
(e.g. `bun link` from the workspace, or a wrapper script). When
running directly from source (`bun run packages/mcp/src/bin.ts`),
pass an explicit absolute `bin` so the snippet is paste-ready
without further editing.

**Output**

```json
{
  "name": "cuekit",
  "command": "/usr/local/bin/cuekit",
  "args": ["--mcp"],
  "mcpServers": {
    "cuekit": {
      "command": "/usr/local/bin/cuekit",
      "args": ["--mcp"]
    }
  }
}
```

`mcpServers` is a paste-ready snippet.

---

## 12. MCP Error Semantics

### 12.1 Tool-Level Errors vs Structured Errors

cuekit should prefer **structured error payloads** for protocol-level conditions when possible, especially where the caller may recover.

Examples:
- unsupported steering
- non-terminal collect attempt
- adapter launch failure
- task not found

Hard MCP tool failure should be reserved for:
- malformed tool input
- internal server exceptions
- unrecoverable persistence corruption

### 12.2 Standard Error Codes

Recommended cuekit error codes:

- `adapter_not_found`
- `submit_failed`
- `status_unavailable`
- `steering_unsupported`
- `collect_unavailable`
- `task_not_found`
- `session_not_found`
- `invalid_state`
- `invalid_input`
- `runtime_crash`
- `timeout`
- `malformed_result`
- `permission_denied`
- `transport_error`
- `unknown`

---

## 13. MCP Surface Rules

### 13.1 Stability Rules

- tool names should be stable once published
- command names should remain aligned with tool names where practical
- optional fields may be added over time
- required field changes should be versioned explicitly

### 13.2 Behavioral Rules

- `submit_task` must never block until completion
- `get_task_status` must reflect persisted or observed truth as best as possible
- `get_task_result` must not fabricate success when terminal evidence is missing
- `steer_task` must not claim success if the runtime rejected the message

### 13.3 Truthfulness Principle

The MCP API must reveal runtime limits honestly.

If a target runtime cannot:
- steer
- expose rich artifacts
- provide live progress updates

then cuekit should say so explicitly instead of pretending uniform support.

### 13.4 Command/Tool Parity Rule

The CLI and MCP surfaces should not drift semantically.

- if a cuekit operation exists as an MCP tool, it should come from the same `incur` command definition used by the CLI
- Zod schemas attached to command definitions are the canonical source for command/tool input and output validation
- MCP-specific glue should stay thin and should not redefine business semantics already captured in core schemas

---

## 14. Typical Orchestrator Flow

### 14.1 Basic Flow

1. call `list_adapters`
2. call `submit_task`
3. poll with `get_task_status`
4. optionally call `steer_task`
5. when terminal, call `get_task_result`
6. decide next action

### 14.2 Example

```text
submit_task(agent_kind="pi", objective="Implement retry logic")
-> task_123

get_task_status(task_123)
-> running

steer_task(task_123, "Also cover exponential backoff")
-> ok

get_task_status(task_123)
-> completed

get_task_result(task_123)
-> normalized result
```

---

## 15. Suggested Future Extensions

Deferred from v0 but compatible with this API shape:

- `subscribe_task_events`
- `resume_task`
- `retry_task`
- `fork_task`
- `get_task_artifact`
- `get_task_transcript`
- `wait_for_task`
- dependency-aware batch submission

These should be added only when the core lifecycle proves stable.

---

## 16. Related Reading

For context on why cuekit uses MCP as a practical control surface while staying conceptually closer to agent delegation protocols, see [Related Work and Implementation References](2026-04-23-cuekit-related-work.md).

## 17. Recommendation

The cuekit MCP API should remain intentionally small in v0.

It should expose only the task lifecycle and capability discovery. More advanced orchestration features should be layered above the MCP surface rather than baked into the first release.
