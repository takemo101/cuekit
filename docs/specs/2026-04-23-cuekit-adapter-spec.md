# cuekit Adapter Specification v0

> Architectural boundary rules for adapters live in [`../architecture/README.md`](../architecture/README.md).

> Adapter contracts and runtime-specific responsibilities for pi, Claude Code, and OpenCode.

## 1. Purpose

This document defines how concrete agent adapters must implement the cuekit protocol.

The cuekit core is intentionally runtime-agnostic. Adapters are the layer that translates between:

- cuekit job semantics
- runtime-native session/task/process semantics
- runtime-native result and progress formats

This spec focuses on the MVP adapters:

- `PiAdapter`
- `ClaudeCodeAdapter`
- `OpenCodeAdapter`

---

## 2. Adapter Role

Each adapter wraps a target coding agent runtime and exposes the cuekit protocol:

- `submit`
- `status`
- `steer`
- `collect`
- `cancel`
- `list`

The adapter must hide runtime-specific details from the orchestrator.

### 2.1 Key Rule

The orchestrator should reason in terms of **jobs**, not in terms of:

- shell processes
- PTY sessions
- prompt turn IDs
- vendor-specific session records
- raw transcripts

The adapter is responsible for the translation boundary.

---

## 3. Common Adapter Requirements

Every cuekit adapter must implement these requirements.

### 3.1 Submission

On `submit(spec)` the adapter must:

1. validate the incoming `JobSpec`
2. ensure the target runtime is available
3. create any required execution state
4. map the submitted job to runtime-native identifiers
5. persist enough metadata for future `status`, `collect`, and `cancel`
6. return a stable cuekit `job_id`

### 3.2 Status Tracking

On `status(job_id)` the adapter must:

1. resolve the cuekit job record
2. inspect the underlying runtime state
3. translate native runtime state into cuekit `JobStatus`
4. return a normalized `JobStatusView`

### 3.3 Result Collection

On `collect(job_id)` the adapter must:

1. verify the job is terminal
2. gather terminal output, transcript, and relevant artifacts
3. normalize the outcome into `JobResult`
4. preserve raw output via `ArtifactRef` when possible

### 3.4 Cancellation

On `cancel(job_id)` the adapter must:

1. attempt runtime-native cancellation
2. update local state regardless of runtime response if termination is confirmed
3. return a structured `Ack`

### 3.5 Steering

If runtime steering is supported, `steer()` should deliver the message into the live runtime.

If unsupported, the adapter must return:

```json
{
  "ok": false,
  "error": {
    "code": "steering_unsupported",
    "message": "This runtime does not support steering for active jobs."
  }
}
```

### 3.6 Artifact Preservation

Adapters should preserve at least one of:

- transcript
- final raw output
- report file
- patch file
- structured JSON metadata

---

## 4. Shared Internal Model

Adapters may store runtime-specific metadata, but they should converge on a common persisted envelope.

```ts
interface PersistedJobRecord {
  job_id: string;
  agent_kind: string;
  spec: JobSpec;
  status: JobStatus;
  native: {
    session_id?: string;
    task_id?: string;
    process_id?: string;
    transport?: "cli" | "http" | "mcp" | "other";
    metadata?: Record<string, unknown>;
  };
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  supports_steering: boolean;
  transcript_path?: string;
  result_path?: string;
  error?: JobError;
}
```

---

## 5. Status Translation Rules

Adapters must translate runtime-native states into the cuekit state machine.

### 5.1 Translation Table

| Native condition | cuekit status |
|---|---|
| accepted but not started | `queued` |
| actively processing | `running` |
| waiting for user input / clarification / approval | `input_required` |
| success | `completed` |
| explicit failure | `failed` |
| cancelled by controller | `cancelled` |
| exceeded timeout | `timed_out` |
| persistent external blocker | `blocked` |

### 5.2 Ambiguous States

If the runtime exposes a state that does not map cleanly:

- prefer `running` for active ambiguity
- prefer `failed` for terminal ambiguity with error evidence
- use `blocked` only when the runtime cannot proceed without external remediation

---

## 6. Result Normalization Rules

All adapters must normalize runtime-native output into:

```ts
interface JobResult {
  job_id: string;
  status: "completed" | "failed" | "cancelled" | "timed_out" | "blocked";
  summary: string;
  files_changed: string[];
  artifacts: ArtifactRef[];
  error?: JobError;
  metadata?: Record<string, unknown>;
}
```

### 6.1 Summary Quality Rules

The `summary` should be concise and action-relevant.

Good summary:

> Added retry logic with exponential backoff to the API client, updated tests, and ran the targeted suite successfully.

Bad summary:

> The assistant processed the request and used tools.

### 6.2 files_changed

Adapters should infer `files_changed` from the best available source in this order:

1. runtime-native file change metadata
2. patch/diff artifact
3. transcript parsing
4. empty array if unavailable

### 6.3 artifacts

Adapters should emit artifacts even when collection is partial.

Examples:
- transcript file
- patch file
- structured result JSON
- captured log file

---

## 7. PiAdapter

### 7.1 Goal

Wrap pi child sessions and job-like runs into cuekit jobs.

### 7.2 Expected Runtime Model

The pi runtime is expected to support child or delegated session execution with at least some of the following capabilities:

- background or dispatch-style execution
- session identity
- status/output inspection
- optional message injection / steering
- transcript or handoff capture

### 7.3 Responsibilities

`PiAdapter` should:

- submit a child pi run using the best available non-blocking mode
- capture the returned runtime session identifier
- map session lifecycle into cuekit job states
- collect final session output into normalized result form
- expose transcript artifacts when available
- support steering when the active transport supports sending input to the child session

### 7.4 Steering Expectation

For MVP, pi is expected to have one of the best steering stories of the three adapters.

If live input can be sent to a running child session, `PiAdapter` should set:

```json
{ "supports_steering": true }
```

### 7.5 Likely Artifacts

- transcript markdown or plain text
- handoff summary file
- changed file list inferred from transcript or workspace diff

### 7.6 Risk Notes

- output may be rich but inconsistently structured
- status may be tied to session lifecycle rather than explicit job lifecycle
- child completion may be signaled indirectly through session output rather than a formal job event

---

## 8. ClaudeCodeAdapter

### 8.1 Goal

Wrap Claude Code runs or sessions into cuekit jobs.

### 8.2 Expected Runtime Model

Claude Code is expected to be controllable through one of:

- CLI invocation
- persistent session runtime
- tool/session bridge if available in environment

### 8.3 Responsibilities

`ClaudeCodeAdapter` should:

- launch a child Claude Code run in a controlled working directory
- capture the native session identifier if exposed
- preserve the full terminal/session transcript when possible
- provide `status()` based on process/session state
- normalize end-of-run output into a stable `JobResult`

### 8.4 Steering Expectation

For MVP, steering support may be weaker or absent depending on execution path.

If steering is not reliable, `ClaudeCodeAdapter` must declare:

```json
{ "supports_steering": false }
```

and return `steering_unsupported` on `steer()`.

### 8.5 Likely Artifacts

- raw transcript log
- final summary capture
- patch or diff artifact if explicitly produced

### 8.6 Risk Notes

- long-running Claude sessions may be easiest to model as process-backed jobs
- reliable mid-flight steering may depend on runtime-specific session control not guaranteed in MVP
- file change extraction may require diffing workspace state or parsing transcript references

---

## 9. OpenCodeAdapter

### 9.1 Goal

Wrap OpenCode async/session primitives into cuekit jobs.

### 9.2 Expected Runtime Model

OpenCode is expected to be the most naturally async of the MVP runtimes, potentially exposing:

- async task submission
- session or task IDs
- status polling
- optional input response path
- explicit completion states

### 9.3 Responsibilities

`OpenCodeAdapter` should:

- submit asynchronous OpenCode work
- record native task/session identifiers
- map task states into cuekit states
- expose `input_required` when OpenCode pauses for further input
- collect final result and transcript artifacts

### 9.4 Steering Expectation

If OpenCode supports follow-up or response injection for active/pending sessions, `OpenCodeAdapter` should expose steering.

If it only supports response when input is explicitly requested, then:

- `supports_steering` may still be `true`
- but steering semantics should be documented as **state-dependent**

### 9.5 Likely Artifacts

- session transcript
- task metadata JSON
- result summary
- changed file references if exposed by runtime

### 9.6 Risk Notes

- capability shape may differ between CLI, HTTP server, and wrapper-MCP paths
- some states may be richer than cuekit v0 and need collapsing into simpler statuses

---

## 10. Adapter Capability Matrix

Initial planning matrix:

| Adapter | Submit | Status | Collect | Cancel | Steering | Artifacts |
|---|---:|---:|---:|---:|---:|---:|
| PiAdapter | Yes | Yes | Yes | Yes | Partial/Expected | Yes |
| ClaudeCodeAdapter | Yes | Yes | Yes | Yes | No or Partial | Yes |
| OpenCodeAdapter | Yes | Yes | Yes | Yes | Partial/State-dependent | Yes |

This matrix is aspirational for MVP and should be refined during implementation spikes. `Partial` means the adapter can expose the capability under some runtime paths or states, but not as a universal guarantee.

---

## 11. Adapter-Specific Metadata

Adapters may return extra metadata in `JobStatusView.metadata` or `JobResult.metadata`.

Examples:

### PiAdapter
```json
{
  "runtime": "pi",
  "session_mode": "dispatch",
  "native_session_id": "calm-reef"
}
```

### ClaudeCodeAdapter
```json
{
  "runtime": "claude-code",
  "launch_mode": "cli",
  "native_process_state": "running"
}
```

### OpenCodeAdapter
```json
{
  "runtime": "opencode",
  "native_task_id": "task-42",
  "native_session_id": "session-9"
}
```

These fields are non-portable and must not be required by generic orchestrators.

---

## 12. Adapter Error Handling

### 12.1 Required Error Codes

All adapters must use cuekit `JobError` codes where possible:

- `adapter_not_found`
- `submit_failed`
- `status_unavailable`
- `steering_unsupported`
- `collect_unavailable`
- `job_not_found`
- `invalid_state`
- `invalid_input`
- `runtime_crash`
- `timeout`
- `malformed_result`
- `permission_denied`
- `transport_error`
- `unknown`

### 12.2 Native Error Preservation

Adapters should preserve runtime-native details in `details`.

Example:

```json
{
  "code": "transport_error",
  "message": "Failed to poll native OpenCode session.",
  "retryable": true,
  "details": {
    "native_error": "ECONNREFUSED",
    "native_session_id": "session-9"
  }
}
```

---

## 13. Storage Expectations

Each adapter should persist enough information for recovery across control-surface restarts.

Minimum persisted data:

- cuekit `job_id`
- adapter kind
- original `JobSpec`
- native IDs
- timestamps
- current status
- transcript path if any
- final result path if collected
- last known error

Suggested path shape:

```text
.cuekit/
  jobs/
    job_123.json
    job_123.result.json
    job_123.transcript.md
```

---

## 14. Recovery Behavior

Adapters should support best-effort recovery after cuekit restarts.

### 14.1 Recoverable cases
- runtime session still exists and can be polled
- transcript artifact already exists
- terminal result has already been persisted

### 14.2 Non-recoverable cases
- ephemeral process state lost with no external handle
- no transcript, no status API, and no result artifact

In non-recoverable cases, adapters should surface `status_unavailable` or `collect_unavailable` explicitly.

---

## 15. Conformance by Adapter

### A conforming cuekit adapter must:
- accept a `JobSpec`
- return stable `job_id`
- expose normalized `status`
- expose terminal `collect`
- expose structured `cancel`
- declare steering honestly
- preserve raw artifacts when possible

### A high-quality cuekit adapter should:
- support recovery
- support artifact-rich results
- expose progress text usefully
- avoid transcript parsing when runtime-native metadata is available

---

## 16. Related Reading

For implementation influences and scope boundaries, see [Related Work and Implementation References](2026-04-23-cuekit-related-work.md), especially the sections on hive-mcp and ACP.

## 17. Recommendation

MVP implementation should begin with one adapter spike that validates:

- submission lifecycle
- status normalization
- terminal result collection
- artifact persistence
- steering support discovery

After that, the remaining two adapters should be implemented against the same persisted job record shape and capability model.
