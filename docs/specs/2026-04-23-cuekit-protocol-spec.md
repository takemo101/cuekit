# cuekit Protocol Specification v0

> Implementation rules for this protocol live in [`../architecture/README.md`](../architecture/README.md).

> MCP-first, runtime-agnostic protocol for delegating work across coding agents.

## 1. Purpose

This document defines the core protocol for cuekit.

cuekit is designed to let one controller—an agent session, CLI, UI, or automation layer—delegate work to heterogeneous coding agents through a common task abstraction.

The protocol is intentionally:

- **task-oriented**, not transcript-oriented
- **adapter-friendly**, not runtime-specific
- **MCP-first** at the control surface
- **runtime-agnostic** internally

This spec does not require ACP. Adapters may use CLI, HTTP, MCP, or other mechanisms internally.

---

## 2. Core Model

### 2.1 Entities

cuekit defines six core entities:

1. **TaskSpec** — a request sent to an agent runtime
2. **TaskHandle** — a stable identifier returned after submission
3. **TaskStatusView** — the current observable state of a task
4. **SteeringMessage** — a message sent to a running task
5. **TaskResult** — the normalized result of a terminal task
6. **ArtifactRef** — a reference to outputs produced by a task

### 2.2 Protocol Operations

The minimal logical protocol is:

- `submit(task_spec) -> TaskHandle`
- `status(task_id) -> TaskStatusView`
- `steer(task_id, steering_message) -> Ack`
- `collect(task_id) -> TaskResult`
- `cancel(task_id) -> Ack`
- `list(filter?) -> TaskSummary[]`

---

## 3. TaskSpec

### 3.1 Semantics

A `TaskSpec` is a normalized request for work to be executed by a child agent through an adapter.

It should contain enough information that a child runtime can operate with minimal hidden assumptions.

### 3.2 Required Fields

```ts
interface TaskSpec {
  agent_kind: string;
  objective: string;
}
```

- `agent_kind`: target runtime family such as `pi`, `claude-code`, or `opencode`
- `objective`: plain-language description of the work to perform

### 3.3 Optional Fields

```ts
interface TaskSpec {
  model?: string;
  adapter_options?: Record<string, unknown>;
  context?: string;
  constraints?: string[];
  inputs?: InputRef[];
  expected_output?: ExpectedOutputSpec;
  cwd?: string;
  timeout_ms?: number;
  priority?: "low" | "normal" | "high";
  metadata?: Record<string, unknown>;
}
```

### 3.4 Field Guidance

#### `model`
Runtime-specific model name (e.g. `sonnet`, `opus`, `haiku` for claude-code).

- If omitted, cuekit launches the child runtime **without passing a model flag**. The child runtime picks its own internal default. cuekit does not carry or impose a `default_model` on the caller's behalf.
- If present and the adapter exposes `available_models` in its capabilities, cuekit validates membership at submit time and returns `invalid_input` on mismatch. Adapters that do not know the full model list skip this check and let the runtime itself fail at launch.
- If present and the adapter declares `supports_model_selection: false`, cuekit returns `invalid_input`.

#### `adapter_options`
Free-form bag of runtime-specific options (e.g. `temperature`, `max_tokens`, extra CLI flags). Typed as `Record<string, unknown>` because shape is adapter-specific; the target adapter validates and translates these at submit time.

This is the escape hatch for knobs that do not deserve first-class protocol fields. Frequently-used options should be promoted to `TaskSpec` proper over time.

#### `context`
Additional guidance, background, or upstream findings.



#### `constraints`
Rules the worker should follow.

Examples:
- `Do not modify package.json`
- `Only edit files under packages/core`
- `Run tests before completing`

#### `inputs`
Structured references to files, URLs, specs, transcripts, or prior outputs.

#### `expected_output`
Describes the shape the parent expects back.

#### `cwd`
Working directory for the child runtime.

#### `timeout_ms`
Maximum runtime duration before cuekit marks the task as timed out.

#### `priority`
Advisory scheduling hint.

#### `metadata`
Implementation-specific extension space.

---

## 4. InputRef

```ts
interface InputRef {
  kind: "file" | "directory" | "url" | "text" | "artifact" | "spec" | "transcript";
  ref: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
```

### Notes
- `ref` should be stable and dereferenceable by the adapter or runtime.
- `text` inputs may inline their payload in `metadata.content` when needed.

---

## 5. ExpectedOutputSpec

```ts
interface ExpectedOutputSpec {
  format?: "summary" | "json" | "markdown" | "patch" | "mixed";
  require_files_changed?: boolean;
  require_artifacts?: boolean;
  require_tests?: boolean;
  schema_hint?: Record<string, unknown>;
}
```

This is advisory, not a hard validation contract in v0.

---

## 6. TaskHandle

```ts
interface TaskHandle {
  task_id: string;
}
```

### Requirements
- `task_id` must be unique within a cuekit store
- it must remain stable for the life of the task
- adapters may map this to one or more native runtime IDs internally

---

## 7. TaskStatus

### 7.1 Status Enum

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

### 7.2 Status Meanings

- `queued` — accepted but not yet executing
- `running` — actively executing
- `input_required` — cannot continue without steering or external input
- `completed` — finished successfully enough for `collect`
- `failed` — terminal error
- `cancelled` — terminated by caller
- `timed_out` — terminated due to timeout policy
- `blocked` — cannot proceed because of a persistent constraint or unmet dependency

---

## 8. TaskStatusView

```ts
interface TaskStatusView {
  task_id: string;
  agent_kind: string;
  status: TaskStatus;
  summary?: string;
  progress_text?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  native_session_id?: string;
  native_task_id?: string;
  supports_steering?: boolean;
  supports_attach?: boolean;
  attach_hint?: string;
  error?: JobError;
  artifacts?: ArtifactRef[];
  metadata?: Record<string, unknown>;
}
```

### Notes
- `summary` is a short human-readable current state
- `progress_text` may include recent output or a compact state description
- `supports_steering` should reflect actual runtime capability, not theoretical support
- `supports_attach` indicates whether the task is running on an attachable backend (e.g. the v0 tmux pane backend); `attach_hint` is a command string the user can run to drop into the live child. See `2026-04-23-cuekit-adapter-spec.md` Section 3.8.

---

## 9. SteeringMessage

### 9.1 Purpose

A `SteeringMessage` lets a parent influence an already-running task without replacing the full task.

### 9.2 Shape

```ts
interface SteeringMessage {
  task_id: string;
  message: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

### 9.3 Semantics

Steering is best-effort in v0.

An adapter may:
- inject the message into a live session
- queue it for the next safe runtime boundary
- reject it as unsupported

### 9.4 Ack Behavior

If accepted:

```ts
interface Ack {
  ok: true;
  message?: string;
}
```

If unsupported or invalid:

```ts
interface Ack {
  ok: false;
  error: JobError;
}
```

---

## 10. TaskResult

### 10.1 MVP Shape

```ts
interface TaskResult {
  task_id: string;
  status: "completed" | "failed" | "cancelled" | "timed_out" | "blocked";
  summary: string;
  files_changed: string[];
  artifacts: ArtifactRef[];
  error?: JobError;
  metadata?: Record<string, unknown>;
}
```

### 10.2 Planned v1+ Extensions

Potential future fields:

```ts
interface FutureTaskResultFields {
  next_suggestion?: string;
  needs_human?: boolean;
  questions?: string[];
  confidence?: number;
}
```

### 10.3 Collection Rules

- `collect(task_id)` should only succeed for terminal states; otherwise it should return `JobError { code: "invalid_state" }`
- terminal states are: `completed`, `failed`, `cancelled`, `timed_out`, `blocked`
- adapters should normalize partial transcripts into a stable `summary`
- raw runtime output should be exposed through artifacts where possible

---

## 11. ArtifactRef

```ts
interface ArtifactRef {
  kind:
    | "file"
    | "directory"
    | "report"
    | "patch"
    | "transcript"
    | "json"
    | "url"
    | "log";
  ref: string;
  title?: string;
  description?: string;
  media_type?: string;
  metadata?: Record<string, unknown>;
}
```

### Examples

```json
{
  "kind": "transcript",
  "ref": ".cuekit/tasks/task-123/transcript.md"
}
```

```json
{
  "kind": "patch",
  "ref": ".cuekit/tasks/task-123/result.patch"
}
```

---

## 12. JobError

```ts
interface JobError {
  code:
    | "adapter_not_found"
    | "submit_failed"
    | "status_unavailable"
    | "steering_unsupported"
    | "collect_unavailable"
    | "task_not_found"
    | "invalid_state"
    | "invalid_input"
    | "runtime_crash"
    | "timeout"
    | "malformed_result"
    | "permission_denied"
    | "transport_error"
    | "unknown";
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}
```

### Error Principles
- errors must be explicit
- retryability should be surfaced when known
- adapters should preserve native details in `details` where useful

---

## 13. State Machine

### 13.1 Allowed Transitions

```text
queued -> running
queued -> failed
queued -> cancelled

running -> completed
running -> failed
running -> input_required
running -> blocked
running -> cancelled
running -> timed_out

input_required -> running
input_required -> failed
input_required -> cancelled
input_required -> timed_out

blocked -> running       (optional, after external remediation)
blocked -> cancelled
```

### 13.2 Terminal States

Terminal states are:
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `blocked`

Once terminal, the adapter must not resume the same task in place.

---

## 14. Adapter Contract

### 14.1 Interface

```ts
interface AgentAdapter {
  kind: string;
  capabilities(): AdapterCapabilities;
  submit(spec: TaskSpec): Promise<TaskHandle>;
  status(task_id: string): Promise<TaskStatusView>;
  steer(message: SteeringMessage): Promise<Ack>;
  collect(task_id: string): Promise<TaskResult>;
  cancel(task_id: string): Promise<Ack>;
  list(filter?: TaskListFilter): Promise<TaskSummary[]>;
}
```

`capabilities()` is the source of truth for `list_adapters` output and for control-surface-level pre-flight validation (e.g. checking `TaskSpec.model` against `available_models` before calling `submit`).

### 14.2 Responsibilities

Each adapter must:
- translate `TaskSpec` into runtime-native invocation
- maintain mapping between `task_id` and native session/task identifiers
- translate native runtime state into `TaskStatus`
- expose steering honestly
- normalize terminal output into `TaskResult`
- persist or expose raw artifacts where possible

### 14.3 Non-requirements

An adapter does **not** need to:
- expose the runtime’s full native feature set
- preserve every runtime-specific nuance at protocol level
- support steering if the underlying runtime truly cannot

---

## 15. MCP Surface

cuekit’s primary control surface in v0 is MCP.

### 15.1 Tool Set

Recommended MCP tools:

1. `submit_task`
2. `get_task_status`
3. `steer_task`
4. `get_task_result`
5. `cancel_task`
6. `list_tasks`
7. `list_adapters`

### 15.2 Tool Definitions

#### `submit_task`

Input:

```json
{
  "agent_kind": "pi",
  "objective": "Implement retry logic in the API client",
  "context": "Focus on src/api/client.ts and related tests",
  "constraints": ["Run targeted tests before completion"],
  "cwd": "/repo"
}
```

Output:

```json
{
  "task_id": "task_123"
}
```

#### `get_task_status`

Input:

```json
{ "task_id": "task_123" }
```

Output:

```json
{
  "task_id": "task_123",
  "agent_kind": "pi",
  "status": "running",
  "summary": "Editing API client retry behavior",
  "supports_steering": true,
  "created_at": "2026-04-23T10:00:00Z",
  "updated_at": "2026-04-23T10:02:00Z"
}
```

#### `steer_task`

Input:

```json
{
  "task_id": "task_123",
  "message": "Also cover exponential backoff in tests",
  "reason": "Parent noticed missing edge case"
}
```

Output:

```json
{ "ok": true }
```

#### `get_task_result`

Input:

```json
{ "task_id": "task_123" }
```

Output:

```json
{
  "task_id": "task_123",
  "status": "completed",
  "summary": "Added retry logic with exponential backoff and updated tests.",
  "files_changed": [
    "src/api/client.ts",
    "tests/api/client.test.ts"
  ],
  "artifacts": [
    {
      "kind": "transcript",
      "ref": ".cuekit/tasks/task_123/transcript.md"
    }
  ]
}
```

#### `cancel_task`

Input:

```json
{ "task_id": "task_123" }
```

Output:

```json
{ "ok": true }
```

#### `list_tasks`

Input:

```json
{
  "status": "running",
  "agent_kind": "opencode"
}
```

Output:

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
  ]
}
```

---

## 16. TaskSummary and Filters

```ts
interface TaskSummary {
  task_id: string;
  agent_kind: string;
  status: TaskStatus;
  summary?: string;
  updated_at: string;
}

interface TaskListFilter {
  status?: TaskStatus;
  agent_kind?: string;
  cwd?: string;
}
```

---

## 17. Persistence Model

cuekit should persist task state independently of any one control surface.

### Minimum persisted fields
- task_id
- agent_kind
- original task spec
- native ID mappings
- timestamps
- last observed status
- final result if collected
- artifact references
- last error if any

### Suggested storage model for v0
A local file-backed store is sufficient.

Suggested directory shape:

```text
.cuekit/
  tasks/
    task_123.json
    task_123.result.json
    task_123.transcript.md
```

---

## 18. Capability Discovery

Adapters should expose capabilities through a lightweight metadata surface.

```ts
interface AdapterCapabilities {
  agent_kind: string;
  supports_steering: boolean;
  supports_attach: boolean;
  supports_model_selection: boolean;
  available_models?: string[];
  supports_artifacts?: boolean;
  supports_live_progress?: boolean;
}
```

`supports_attach` is required, not optional, because v0 commits to the tmux pane backend as the primary execution model (see adapter spec Section 3.7). An adapter that cannot expose an attachable pane must declare `supports_attach: false` explicitly.

`supports_model_selection` is also required:
- `true` means the adapter can route `TaskSpec.model` to the child runtime
- `false` means the adapter ignores or rejects `TaskSpec.model`; passing one produces `invalid_input`

`available_models` is optional by design. Adapters that can enumerate their models (e.g. claude-code listing `["haiku", "sonnet", "opus"]`) should surface the list so callers can pre-flight. Adapters that cannot (or choose not to) maintain a list omit the field; in that case `TaskSpec.model` is passed through and the runtime itself fails at launch if the value is bad.

cuekit does **not** carry a `default_model`. If `TaskSpec.model` is omitted the adapter launches the runtime without a model flag and the runtime uses whatever its own internal default is.

Recommended MCP tool:

```json
{
  "tool": "list_adapters"
}
```

Example response:

```json
{
  "adapters": [
    {
      "agent_kind": "pi",
      "supports_steering": true,
      "supports_attach": true,
      "supports_model_selection": false,
      "supports_artifacts": true,
      "supports_live_progress": true
    },
    {
      "agent_kind": "claude-code",
      "supports_steering": false,
      "supports_attach": true,
      "supports_model_selection": true,
      "available_models": ["haiku", "sonnet", "opus"],
      "supports_artifacts": true,
      "supports_live_progress": false
    }
  ]
}
```

---

## 19. Conformance Expectations

### A conforming cuekit adapter must:
- support `submit`, `status`, `collect`, `cancel`
- return a stable `task_id`
- expose terminal states correctly
- provide normalized `TaskResult`
- return explicit structured errors

### A conforming cuekit control surface should:
- preserve protocol semantics faithfully
- not invent hidden task states
- distinguish terminal from non-terminal states
- avoid collapsing failures into plain text only

---

## 20. Versioning

This document defines **v0** of the cuekit protocol.

Versioning principles:
- additive fields are preferred over breaking shape changes
- adapters may ignore unknown optional fields
- MCP tool names should remain stable where possible
- future protocol versions may formalize:
  - partial structured results
  - resume semantics
  - dependency graphs
  - event subscriptions
  - richer steering guarantees

---

## 21. Deferred Topics

Explicitly deferred from v0:
- DAG scheduling
- multi-task transactions
- parent-child lineage model
- cost accounting
- retry policies in protocol
- remote authentication standardization
- event subscription protocol beyond MCP polling

---

## 22. Related Reading

For positioning relative to adjacent protocols and systems, see [Related Work and Implementation References](2026-04-23-cuekit-related-work.md).

## 23. Recommendation

cuekit should implement this protocol in three layers:

1. **Core types and state model**
2. **Adapter implementations for target agents**
3. **MCP control surface exposing protocol operations**

An orchestrator skill, CLI, or other UX should be treated as a consumer of this protocol, not as the protocol itself.
