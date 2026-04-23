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

---

## 2.1 Implementation Strategy

The v0 MCP implementation should use `incur` as the control-surface framework.

Implications:

- each cuekit operation is defined as an `incur` command
- command args/options/output are described with Zod schemas
- the same command definition is used for both CLI execution and MCP tool exposure
- MCP should remain a thin projection of cuekit protocol operations, not a separate orchestration layer

---

## 3. Tool Set

The v0 MCP API consists of seven tools:

1. `submit_task`
2. `get_task_status`
3. `steer_task`
4. `get_task_result`
5. `cancel_task`
6. `list_tasks`
7. `list_adapters`

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
  "agent_kind": "pi",
  "objective": "Implement retry logic in the API client",
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
  "attach_hint": "tmux attach-session -t cuekit-sess_42:task-task_123",
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

List known tasks, optionally filtered.

### 10.2 Input

```json
{
  "status": "running",
  "agent_kind": "opencode",
  "cwd": "/repo"
}
```

All fields are optional.

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
    },
    {
      "task_id": "task_556",
      "agent_kind": "opencode",
      "status": "input_required",
      "summary": "Waiting for clarification on validation target",
      "updated_at": "2026-04-23T10:05:00Z"
    }
  ]
}
```

### 10.4 Summary Shape

Each returned task should include:

- `task_id`
- `agent_kind`
- `status`
- `summary` (optional)
- `updated_at`

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
      "supports_artifacts": true,
      "supports_live_progress": true
    },
    {
      "agent_kind": "claude-code",
      "supports_steering": false,
      "supports_attach": true,
      "supports_artifacts": true,
      "supports_live_progress": false
    },
    {
      "agent_kind": "opencode",
      "supports_steering": true,
      "supports_attach": true,
      "supports_artifacts": true,
      "supports_live_progress": true
    }
  ]
}
```

All three MVP adapters ride on the v0 tmux pane backend (see adapter spec Section 3.7), so `supports_attach` is `true` across the board. `get_task_status` surfaces an `attach_hint` such as `tmux attach-session -t cuekit-{session_id}:task-{id}` that a user can run to drop directly into the live child pane.

### 11.4 Semantics

This tool is intended for:

- orchestrator planning
- runtime feature discovery
- graceful degradation when a capability is missing

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
- `invalid_state`
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
