# cuekit Adapter Specification v0

> Architectural boundary rules for adapters live in [`../architecture/README.md`](../architecture/README.md).

> Adapter contracts and runtime-specific responsibilities for pi, Claude Code, and OpenCode.

## 1. Purpose

This document defines how concrete agent adapters must implement the cuekit protocol.

The cuekit core is intentionally runtime-agnostic. Adapters are the layer that translates between:

- cuekit task semantics
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

The orchestrator should reason in terms of **tasks**, not in terms of:

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

1. validate the incoming `TaskSpec`
2. ensure the target runtime is available
3. create any required execution state
4. map the submitted task to runtime-native identifiers
5. persist enough metadata for future `status`, `collect`, and `cancel`
6. return a stable cuekit `task_id`

### 3.2 Status Tracking

On `status(task_id)` the adapter must:

1. resolve the cuekit task record
2. inspect the underlying runtime state
3. translate native runtime state into cuekit `TaskStatus`
4. return a normalized `TaskStatusView`

### 3.3 Result Collection

On `collect(task_id)` the adapter-facing contract must return a `TaskResult` for terminal tasks. In v0, concrete adapters may gather terminal output, transcripts, and artifacts and normalize them directly. In the post-v0 child-reporting path, shared result normalization owns the final `TaskResult`; concrete adapters supply only runtime fallback data and artifact refs. The collect path must:

1. verify the task is terminal
2. prefer canonical store-backed child-reported payloads when present
3. gather terminal output, transcript, and relevant artifacts as fallback data
4. assemble or validate the final `TaskResult` through the shared result normalizer
5. preserve raw output via `ArtifactRef` when possible

### 3.4 Cancellation

On `cancel(task_id)` the adapter must:

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
    "message": "This runtime does not support steering for active tasks."
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

### 3.7 Execution Backend (v0: tmux session-per-task)

In v0, cuekit child agents are not headless one-shot subprocesses. Every delegated task runs inside its own **dedicated tmux session** so the orchestrator can submit, cancel, and steer programmatically *and* so a human can `tmux attach-session` to the live child for debugging. The cuekit orchestration session is a logical grouping (persisted in SQLite) only, not mirrored in tmux — this keeps attach and cleanup as single-command operations.

This layout is the flat one proven by isuner (1 issue = 1 tmux session). Claude Code's Agent Teams uses a grouped layout instead; we defer grouping to a future opt-in feature.

#### 3.7.1 Layout

- one tmux session per cuekit task
  - name: `cuekit-task-{task_id}` (stable for the life of the task)
  - created at `submit` time; v0 cleanup kills it when the runtime reaches an observed terminal state or the task is cancelled
  - holds exactly one pane running the child runtime
- the cuekit orchestration session is **not** represented in tmux; it only lives as a `session_id` foreign key on the task row
- the pane id is captured at submit time and stored as the task's `native_task_ref`

#### 3.7.2 Protocol → tmux mapping

| cuekit op | pane backend implementation |
|---|---|
| `submit` | `tmux new-session -d -s cuekit-task-{id} -c <cwd> "<runtime launch command>"`; capture `pane_id` |
| `status` | `tmux has-session -t cuekit-task-{id}` for liveness; tail transcript file for `progress_text` |
| `collect` | return a normalized `TaskResult`; v0 may use adapter fallback extraction from task refs / optional runtime `result.json`; post-v0 shared result normalization should prefer store-backed child-reported payloads before adapter fallback data |
| `cancel` | `tmux kill-session -t cuekit-task-{id}` |
| `steer` | `tmux send-keys -t cuekit-task-{id} -l "<message>"` → short delay → `tmux send-keys -t cuekit-task-{id} Enter` |
| transcript capture | `tmux pipe-pane -t {pane_id} 'cat > <worktree>/.cuekit/tasks/<id>/transcript.txt'` on submit |

The two-step `send-keys` pattern (`-l` for literal text, then a separate `Enter`) is the TUI-safe steering shape proven by isuner; a single-shot `send-keys "<msg>" Enter` can drop characters on rich TUIs.

#### 3.7.3 Cleanup

- on v0 observed terminal state, cancel, or timeout, the shared pane backend is responsible for killing the task's tmux session (`tmux kill-session -t cuekit-task-{id}`); a post-v0 child-reported terminal event may update task status before any optional pane shutdown policy runs
- transcript and result files persist under `<worktree>/.cuekit/tasks/` even after tmux cleanup
- the pane-backed adapter wrapper must not leak tmux sessions across parent restarts; on startup it should reconcile persisted task state against live tmux sessions

#### 3.7.4 Environment Requirements

- `tmux` must be installed and on `PATH` in the cuekit host environment.
- if `tmux` is unavailable, the adapter must return `submit_failed` with an explicit hint to install tmux. No silent fallback in v0.
- alternative backends (in-process, remote, fully headless) are deferred; v0 is pane-only.

#### 3.7.5 Adapter responsibility split

With the pane backend shared across adapters, each concrete adapter only provides:

- the **launch command** to run inside the new pane (runtime-specific)
- a **result/transcript extractor** for runtime fallback data; shared result normalization should prefer store-backed child-reported payloads when present
- runtime-specific **status heuristics** (e.g. recognizing `input_required` by pattern-matching tail output)

Spawning, pane lifecycle, cancellation, attach-hint production, and basic transcript capture are shared infrastructure, not per-adapter work.

### 3.8 Debug Attach

The pane backend makes debug attach a first-class v0 capability.

#### 3.8.1 attach_hint

Each live task exposes an `attach_hint` string that a human (or a parent tool) can run to drop directly into the live child pane:

```text
tmux attach-session -t cuekit-task-{task_id}
```

`attach_hint` is returned from `status()` while the task is non-terminal and `supports_attach` is `true`.

#### 3.8.2 Capability declaration

Adapters using the pane backend should declare:

```json
{ "supports_attach": true }
```

Adapters on an alternative backend that does not expose a real terminal must declare:

```json
{ "supports_attach": false }
```

No `attach_hint` should be surfaced in that case.

#### 3.8.3 Semantics

- `attach_hint` is best-effort: if the pane has already been torn down (e.g. right after a terminal transition), attach will fail harmlessly.
- cuekit does not mediate attach itself; the user runs the command in their own terminal.
- attach is purely observational unless the user types into the pane, which behaves like a manual steer.

---

## 4. Shared Internal Model

Adapters may store runtime-specific metadata, but they should converge on a common persisted envelope.

```ts
interface PersistedTaskRecord {
  task_id: string;
  agent_kind: string;
  model?: string;
  spec: TaskSpec;
  status: TaskStatus;
  native: {
    // v0 pane backend (tmux), 1 task = 1 tmux session
    tmux_session_name?: string;   // e.g. "cuekit-task-{task_id}"
    tmux_pane_id?: string;        // also surfaced as native_task_ref
    // runtime-native identifiers, if the child runtime exposes them
    runtime_session_id?: string;
    runtime_task_id?: string;
    process_id?: string;
    transport?: "pane" | "cli" | "http" | "mcp" | "other";
    metadata?: Record<string, unknown>;
  };
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  supports_steering: boolean;
  supports_attach: boolean;
  attach_hint?: string;
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

In v0/direct adapter fallback paths, adapters normalize runtime-native output into `TaskResult`. In the post-v0 child-reporting path, child-facing handlers validate store-backed result payloads and the shared result normalizer assembles the canonical `TaskResult`; concrete adapters only contribute runtime fallback data and artifact refs. The normalized shape remains:

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

**v0 limitation**: the shipped pane adapters (`pi`, `claude-code`,
`opencode`) all return `files_changed: []` regardless of whether the
child actually touched files. None of the runtimes currently emit
machine-readable file-change metadata, and transcript parsing is not
planned without a concrete metadata/recovery need. Callers that need file
enumeration should diff the worktree themselves (`git status` against the
session's `worktree_path`). This generic transcript parsing note is about
best-effort file-change extraction, not child-report transcript markers;
marker parsing is not part of the child-reporting contract. The
`artifacts` array is correctly populated in v0 (transcript ref +
result.json ref when present).

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

Wrap pi child sessions and task-like runs into cuekit tasks.

### 7.2 Expected Runtime Model

The pi runtime is expected to support child or delegated session execution with at least some of the following capabilities:

- background or dispatch-style execution
- session identity
- status/output inspection
- optional message injection / steering
- transcript or handoff capture

### 7.3 Responsibilities

`PiAdapter` should:

- launch pi inside a cuekit task pane (see Section 3.7) using the runtime's interactive dispatch entrypoint, not a headless one-shot
- capture the pane id (`native_task_ref`) and any runtime-native session id pi exposes
- map session lifecycle into cuekit task states
- collect final session output into normalized result form by reading the piped transcript and/or a pi-native handoff file
- expose transcript artifacts when available
- support steering via `tmux send-keys` when the underlying pi session accepts live input

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
- status may be tied to session lifecycle rather than explicit task lifecycle
- child completion may be signaled indirectly through session output rather than a formal task event

---

## 8. ClaudeCodeAdapter

### 8.1 Goal

Wrap Claude Code runs or sessions into cuekit tasks.

### 8.2 Expected Runtime Model

Claude Code is expected to be controllable through one of:

- CLI invocation
- persistent session runtime
- tool/session bridge if available in environment

### 8.3 Responsibilities

`ClaudeCodeAdapter` should:

- launch `claude` inside a cuekit task pane in **interactive mode** (not `-p`/print/headless mode) so the pane remains a real TTY that a human can attach to. The objective can be passed as the initial prompt (`claude "<objective>"`) or injected by `tmux send-keys` after launch.
- capture the pane id and any native session identifier Claude Code exposes
- preserve the full pane transcript via `tmux pipe-pane`
- provide `status()` based on pane liveness plus transcript tailing heuristics
- normalize end-of-run output into a stable `TaskResult` by parsing transcript tail and, if available, any JSON/patch artifacts the run produces

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

- long-running Claude sessions may be easiest to model as process-backed tasks
- reliable mid-flight steering may depend on runtime-specific session control not guaranteed in MVP
- file change extraction may require diffing workspace state or parsing transcript references

---

## 9. OpenCodeAdapter

### 9.1 Goal

Wrap OpenCode async/session primitives into cuekit tasks.

### 9.2 Expected Runtime Model

OpenCode is expected to be the most naturally async of the MVP runtimes, potentially exposing:

- async task submission
- session or task IDs
- status polling
- optional input response path
- explicit completion states

### 9.3 Responsibilities

`OpenCodeAdapter` should:

- launch OpenCode inside a cuekit task pane (see Section 3.7) using its interactive/session mode so the pane is attachable
- record the pane id and OpenCode's native task/session identifiers
- map OpenCode task states into cuekit states; when OpenCode exposes an async task API, prefer it for status over transcript scraping
- expose `input_required` when OpenCode pauses for further input
- collect final result and transcript artifacts from the piped transcript plus OpenCode-native result endpoints if available

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

| Adapter | Submit | Status | Collect | Cancel | Steering | Attach | Artifacts |
|---|---:|---:|---:|---:|---:|---:|---:|
| PiAdapter | Yes | Yes | Yes | Yes | Partial/Expected | Yes (tmux) | Yes |
| ClaudeCodeAdapter | Yes | Yes | Yes | Yes | No or Partial | Yes (tmux) | Yes |
| OpenCodeAdapter | Yes | Yes | Yes | Yes | Partial/State-dependent | Yes (tmux) | Yes |

This matrix is aspirational for MVP and should be refined during implementation spikes. `Partial` means the adapter can expose the capability under some runtime paths or states, but not as a universal guarantee. All three MVP adapters ride on the v0 pane backend (Section 3.7), so attach is universally `true` for v0.

---

## 11. Adapter-Specific Metadata

Adapters may return extra metadata in `TaskStatusView.metadata` or `TaskResult.metadata`.

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
- `task_not_found`
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

- cuekit `task_id`
- adapter kind
- original `TaskSpec`
- native IDs
- timestamps
- current status
- transcript path if any
- final result path if collected
- last known error

Suggested path shape for local artifacts:

```text
.cuekit/
  tasks/
    task_123/
      transcript.txt
      result.json   # optional runtime/export artifact, not canonical state
      exit-code
```


---

## 13.1 Child Reporting and Graceful Shutdown (post-v0 extension)

This section describes a post-v0 / v2 extension, not a requirement for the current v0 adapter contract. Pane-backed adapters should eventually support a child reporting contract in addition to transcript capture. On submit, the adapter should inject enough context for the child-facing CLI/MCP surface to authenticate and target the current task, for example:

```sh
CUEKIT_TASK_ID=t_abc
CUEKIT_CHILD_TOKEN=ck_child_...
CUEKIT_PARENT_SESSION_ID=s_abc
```

Adapters should also inject or reference the cuekit child-task skill when the runtime supports skills or prompt augmentation. That skill tells the child to prefer the MCP `report_task_event` tool and fall back to `cuekit tool report ...`. Transcript markers are not part of the child-facing contract while MCP or CLI reporting is available, and are not planned without a concrete recovery need.

When cuekit receives a child report, responsibilities should stay layered:

1. The child-facing control-surface handler validates authorization and appends a row to `task_events`.
2. For terminal event types (`completed`, `failed`, `blocked`), the store may update the task row through normal status transitions.
3. Runtime shutdown, if handled at all, remains a separate adapter/shared-pane lifecycle concern.
4. The concrete adapter supplies runtime-specific shutdown input (`/exit`, `ctx.shutdown()`, equivalent command, or API call) only for that separate lifecycle feature, not for child reporting.

A child report is durable task state even before the runtime exits. A later clean shutdown exit code must not automatically override a child-reported `failed` or `blocked` event into `completed`. Shutdown failure handling belongs to the separate runtime lifecycle layer, not the child-reporting contract.

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
- accept a `TaskSpec`
- return stable `task_id`
- expose normalized `status`
- expose terminal `collect`
- expose structured `cancel`
- declare steering honestly
- declare attach honestly (`supports_attach`) and surface `attach_hint` when true
- preserve raw artifacts when possible

### A high-quality cuekit adapter should:
- support recovery
- support artifact-rich results
- expose progress text usefully
- post-v0: inject child reporting context when running interactive children
- avoid transcript parsing when runtime-native metadata is available
- reuse the shared pane backend (Section 3.7) instead of re-implementing process/session management

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

After that, the remaining two adapters should be implemented against the same persisted task record shape and capability model.
