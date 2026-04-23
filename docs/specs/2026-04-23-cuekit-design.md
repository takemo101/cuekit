# cuekit Design

> Architecture constraints for implementing this design live in [`../architecture/README.md`](../architecture/README.md).

> Protocol and adapter foundation for orchestrating coding agents.

## 1. Summary

cuekit is a protocol-first foundation for coordinating coding agents such as pi, Claude Code, and OpenCode. Its core value is not a particular orchestrator implementation, but a shared job protocol and adapter model that let one agent session delegate work to another, monitor progress, steer execution, and collect normalized results.

Orchestration skills, MCP servers, CLIs, and UIs are treated as optional control surfaces built on top of this core.

## 2. Problem

Today, coding agents can often spawn or control other agents in ad hoc ways, but each integration is different:

- different session models
- different transports
- different completion semantics
- different result formats
- weak support for mid-flight steering

This makes multi-agent workflows brittle and agent-specific.

What is missing is a small common layer that answers:

1. How do I submit work to another agent?
2. How do I observe its state?
3. How do I steer it while it is running?
4. How do I collect a result in a predictable shape?
5. How do I adapt different agent runtimes without rewriting orchestration logic?

## 3. Goals

- Define a minimal job-oriented protocol for agent-to-agent work delegation.
- Define an adapter contract for wrapping heterogeneous coding agents.
- Support asynchronous execution as the default model.
- Support optional mid-flight steering.
- Normalize child results so orchestration logic can be portable.
- Make orchestration implementable in multiple surfaces: skill, MCP, CLI, HTTP, or UI.
- Support MVP adapters for pi, Claude Code, and OpenCode.

## 4. Non-goals

- Building a full autonomous planner in v1.
- Standardizing every agent’s internal conversation model.
- Forcing every integration to use MCP internally.
- Replacing each agent’s native UX.
- Solving distributed scheduling at internet scale.

## 5. Design Principles

1. **Protocol first** — orchestration depends on a stable contract, not prompt magic.
2. **Adapter isolation** — agent-specific quirks stay behind adapters.
3. **Async by default** — child work is treated as a job, not a blocking call.
4. **Steer when needed** — long-running jobs must be redirectable.
5. **Normalized results** — parent logic should not parse raw transcripts by default.
6. **Control-surface agnostic at the core** — skills, MCP, CLI, and other surfaces are consumers of the core, not the core itself. For v0, MCP is the primary reference control surface.
7. **Human checkpoint friendliness** — v1 should stop when ambiguity is high.

## 6. Core Abstractions

### 6.1 JobSpec
A parent’s request to a child runtime.

Proposed fields:

- adapter-assigned `job_id`
- `agent_kind` — `pi | claude-code | opencode | ...`
- `objective`
- `context`
- `constraints`
- `inputs`
- `expected_output`
- `priority`
- `timeout_ms`
- `metadata`

### 6.2 JobStatus
The current lifecycle state of a child job.

Initial state set:

- `queued`
- `running`
- `input_required`
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `blocked`

### 6.3 SteeringMessage
An instruction sent to a running job.

Proposed fields:

- `job_id`
- `message`
- `reason`
- `metadata`

### 6.4 JobResult
Normalized output returned by a child job.

MVP fields:

- `status`
- `summary`
- `files_changed`
- `artifacts`

Planned later fields:

- `next_suggestion`
- `needs_human`
- `questions`
- `confidence`

### 6.5 ArtifactRef
Reference to output produced by a child job.

Examples:

- changed file path
- report file
- patch file
- session transcript
- URL
- structured JSON payload

## 7. Minimal Protocol

cuekit’s minimal contract is the following logical API:

- `submit(job_spec) -> { job_id }`
- `status(job_id) -> JobStatusView`
- `steer(job_id, steering_message) -> Ack`
- `collect(job_id) -> JobResult`
- `cancel(job_id) -> Ack`
- `list() -> JobSummary[]`

This is the protocol whether the transport is MCP, HTTP, local process control, or a file-backed runtime.

## 8. Adapter Contract

Each agent adapter must implement the cuekit protocol over a specific runtime.

### Responsibilities

- start child execution
- map native session/task IDs to `job_id`
- translate native states into cuekit `JobStatus`
- accept steering where possible
- collect and normalize results
- expose artifacts and transcripts
- report errors in a uniform way

### Adapter Interface

Conceptually:

```ts
interface AgentAdapter {
  kind: string;
  submit(spec: JobSpec): Promise<JobHandle>;
  status(job_id: string): Promise<JobStatusView>;
  steer(message: SteeringMessage): Promise<Ack>;
  collect(job_id: string): Promise<JobResult>;
  cancel(job_id: string): Promise<Ack>;
  list(filter?: JobListFilter): Promise<JobSummary[]>;
}
```

## 9. Runtime Model

cuekit should treat transports as interchangeable.

### Possible runtime backends

- **MCP-backed adapter** — useful when an agent exposes callable tool surfaces.
- **HTTP-backed adapter** — useful when an agent offers a server API.
- **CLI-backed adapter** — useful when the runtime is best controlled as a local process/session.
- **Hybrid adapter** — submit via CLI, observe via session store, steer via local socket or command channel.

Important: adapters are not identical to MCP. MCP is one possible exposure or transport layer.

## 10. Reference Adapters for MVP

### 10.1 PiAdapter
Goal: wrap pi child sessions/jobs into cuekit jobs.

Needs:

- spawn/dispatch child session
- retrieve status/output
- support steering if available
- normalize result payload

### 10.2 ClaudeCodeAdapter
Goal: wrap Claude Code sessions/jobs into cuekit jobs.

Needs:

- child invocation strategy
- session/job identity mapping
- transcript/result capture
- partial or full steering support depending on runtime limits

### 10.3 OpenCodeAdapter
Goal: wrap OpenCode async/session primitives into cuekit jobs.

Needs:

- async task submission
- session polling
- input/steering path if supported
- normalized result extraction

## 11. Result Normalization

Parents should consume normalized child outputs instead of parsing raw transcripts.

### MVP result shape

```json
{
  "status": "completed",
  "summary": "Implemented retry logic in the API client and ran the targeted tests.",
  "files_changed": [
    "src/api/client.ts",
    "tests/api/client.test.ts"
  ],
  "artifacts": [
    {
      "kind": "transcript",
      "ref": ".cuekit/jobs/job-123/transcript.md"
    }
  ]
}
```

## 12. State Transitions

Typical lifecycle:

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> input_required -> running -> completed
queued -> running -> blocked
queued -> running -> timed_out
queued -> running -> cancelled
```

## 13. Failure Model

cuekit should model failure at the protocol boundary, not hide it.

### Failure cases

- adapter launch failure
- transport disconnection
- unsupported steering
- malformed result
- timeout
- child runtime crash
- ambiguous completion state

### MVP handling

- return explicit terminal state
- persist raw transcript if available
- include adapter error envelope
- allow parent to choose retry, replan, or human escalation

## 14. Orchestration Surfaces

cuekit itself is not the orchestrator. It enables orchestrators.

### Examples

- **Orchestrator skill** for an existing coding agent session
- **MCP server** exposing cuekit tools
- **CLI** for manual submission and inspection
- **HTTP API** for external controllers

The orchestrator skill is therefore an optional reference layer that explains how a parent agent should use adapters and protocol operations. It should be explicit-invocation only, never auto-activated during ordinary coding work.

## 15. MVP Scope

### In scope

- protocol spec draft
- adapter contract
- result schema v1
- state model
- failure model
- MVP adapters for pi / Claude Code / OpenCode
- at least one reference control surface

### Out of scope for MVP

- advanced automatic replanning
- distributed worker pools
- full DAG scheduler
- cost-aware model routing
- generalized multi-tenant cloud control plane

## 16. Recommended Implementation Order

1. Write protocol and schema documents.
2. Implement local job store and state model.
3. Build one adapter end to end.
4. Add remaining MVP adapters.
5. Expose the primary MCP control surface.
6. Add an explicit-invocation orchestrator skill as a reference integration.

## 17. Open Questions

- What is the minimal required steering guarantee across runtimes?
- Should `collect()` be valid only for terminal states, or also return partial structured output?
- How much transcript content should be preserved by default?
- What is the canonical artifact model for patches vs files vs external URLs?
- Which adapter capabilities are truly necessary in v0 versus later revisions?

## 18. Related Work

See [Related Work and Implementation References](2026-04-23-cuekit-related-work.md) for external references that informed cuekit's boundaries and implementation thinking, including A2A, MCP-A2A bridges, hive-mcp, and ACP.

## 19. Recommendation

cuekit should proceed as a protocol-and-adapter project first. The first design and implementation pass should optimize for stable contracts and portable orchestration logic, not for a single orchestrator UX. Skills, MCP servers, and other surfaces should be developed as thin consumers of the core.
