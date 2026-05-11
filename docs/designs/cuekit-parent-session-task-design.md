# Design: Parent session tasks and handoffs

## Status

Proposed design note.

## Problem

cuekit's core model already lets a parent agent submit tasks, observe status, steer interactive panes, attach to running agents, and collect durable `task_events`. That works well when the parent agent already exists outside cuekit.

A different workflow needs cuekit to create the shared parent workspace itself:

1. A human or agent starts a long-lived parent agent under cuekit.
2. Humans can attach to that parent agent and continue development interactively.
3. Other agents can inspect the current state and intervene while the human is away.
4. The parent agent can start coordinator-led teams and manage worker/reviewer/finisher tasks.
5. Any agent can send a structured handoff into the running parent agent, or into another steerable task, so work can continue without relying on one local terminal session.

Adding a separate `session` API for this would create a large parallel surface (`session start`, `session attach`, `session steer`, `session status`, `session transcript`, `session stop`) whose implementation would mostly alias existing task operations. The first slice should keep cuekit small.

## Goals

- Represent a managed parent-agent workspace without adding a new session table or session API.
- Reuse existing task submission, attach, status, transcript, steering, and event surfaces.
- Let humans create and attach to a parent workspace from the TUI.
- Let any external actor, not only Hermes Agent, send handoffs or steering messages.
- Make handoff a generic task-to-task / actor-to-task context transfer, not a parent-session-only feature.
- Provide a simple state-reading path so an agent can decide whether and how to intervene mid-flight.
- Preserve cuekit's guidance-first stance: no auto-scheduler, auto-wake, or auto-steer rules.

## Non-goals

- No new public `session` CLI or MCP API in the MVP.
- No `sessions` or `session_events` table for parent workspaces.
- No `--actor`, `--source`, authentication, identity, ack/read, or delivery tracking model.
- No cron scheduler inside cuekit.
- No automatic injection into coordinators or workers based on events.
- No remote multi-user authorization model.
- No LLM summarization requirement for the first state-reading surface.

## Core model

A managed parent session is a **long-lived interactive task**.

```text
parent session = task with metadata.run_kind == "parent_session"
```

The task remains a normal cuekit task for storage, attach, steering, events, transcript, and cancellation. The distinction is semantic metadata plus role/profile guidance.

Suggested task metadata:

```json
{
  "run_kind": "parent_session",
  "long_lived": true
}
```

Optional future metadata can be added without changing the model:

```json
{
  "run_kind": "parent_session",
  "long_lived": true,
  "human_attachable": true
}
```

This metadata must be part of the task's submitted spec metadata, not adapter/status metadata. Command-layer list/status/snapshot surfaces that need to identify parent sessions should expose either:

- the relevant task spec metadata fields, or
- a derived top-level `run_kind` field copied from task spec metadata.

The TUI must not infer parent sessions by querying private store details or by reading adapter status metadata such as pane ids. It should use the same command-layer task summary/status/snapshot data that other clients use.

The parent task's agent is expected to be interactive. Batch mode is not appropriate for parent sessions because batch tasks are not steerable and do not provide a useful shared workspace.

## Relationship to existing teams

The parent session task is above coordinator-led teams in the operator workflow, but not a new persistence root.

```text
Human / Agent / Script
  -> attach / steer / handoff
Parent session task
  -> starts and manages
Task team / coordinator task
  -> manages
Worker / reviewer / finisher tasks
```

The coordinator is the parent agent's implementation manager or "hands" for a bounded objective. It is not the parent workspace itself. Parent sessions may start zero, one, or many teams over their lifetime.

## Parent role/profile

Add a parent-oriented agent profile, for example a builtin or project/user profile named `parent`:

```md
---
role: parent
agent_kind: pi
---

You are a long-lived parent development agent for this project.

You are running inside cuekit as a managed parent session task. Humans or other agents may attach, steer, or send HANDOFF messages while you are running.

Wait for user instructions when no objective is provided. When appropriate, use cuekit teams, coordinators, workers, reviewers, and finishers to make progress. Treat coordinators as implementation managers for bounded work, not as your replacement.

When receiving a HANDOFF, read it as state transfer, summarize your understanding, identify open questions or risks, and continue from the current project state.
```

A parent session may be started with an explicit objective, or with only the bootstrap role prompt. The empty-session case is important for humans who want to create a shared workspace first and decide the work interactively after attaching.

## CLI/MCP usage without session API

Create a parent session task:

```sh
cuekit task submit \
  --role parent \
  --agent_kind pi \
  --objective "You are a long-lived parent development agent for this project." \
  --metadata '{"run_kind":"parent_session","long_lived":true}' \
  --timeout_ms null
```

Attach to it:

```sh
# Read attach_command from status, then run its argv.
cuekit task status --task_id t_parent --format json
```

Steer it:

```sh
cuekit steer target \
  --kind task \
  --task_id t_parent \
  --message "Inspect the current team status and decide the next action."
```

Stop it explicitly:

```sh
cuekit task cancel --task_id t_parent
```

MCP should use the existing grouped task/steer operations. If a future human-friendly `session` command is added, it should be a thin alias over `run_kind: parent_session` tasks, not a separate control plane.

## Handoff as a generic task event

`handoff` is a generic typed task event and steering mode. It is not specific to parent sessions.

```text
handoff = context transfer into a steerable task
```

Examples:

- Hermes Agent -> parent session task
- worker -> reviewer
- investigator -> implementer
- coordinator -> finisher
- parent task -> coordinator task
- GitHub Actions bot -> parent task

The target task receives the handoff through the same input path as steering, and cuekit records a durable event.

### Event type

Add `handoff` to the reportable/recordable task event types. This is illustrative, not a full replacement for the existing event set such as `log`:

```ts
type TaskEventType =
  | "log"
  | "progress"
  | "completed"
  | "failed"
  | "blocked"
  | "help_requested"
  | "handoff";
```

The event is stored on the **target** task. It means: this task received handoff context at this point in time.

### No actor/source fields

Do not add `--actor` or `--source` to the MVP. If a handoff needs to identify who produced it, the producer should write that in the handoff body:

```md
# HANDOFF

From: Hermes Agent
To: parent task t_parent
Date: 2026-05-10
Related team: tm_123

...
```

This avoids an identity model, avoids spoofable-but-official-looking metadata, and keeps the API actor-neutral.

### CLI shape

Use steering with a typed event and file input:

```sh
cuekit steer target \
  --kind task \
  --task_id t_target \
  --event_type handoff \
  --message_file HANDOFF.md
```

Normal steering remains unchanged:

```sh
cuekit steer target \
  --kind task \
  --task_id t_target \
  --message "Please continue with the reviewer feedback."
```

The first slice can require `handoff` targets to be steerable. If `supports_steering` is false, return `steering_unsupported` and do not pretend the running task received the handoff. A later design may allow storing a non-injected handoff for postmortem purposes, but that is not the MVP.

### Handoff artifact storage

Handoffs are often long. Store the full body as an artifact and keep the event row small.

Suggested path:

```text
.cuekit/tasks/<task_id>/handoffs/<sequence>.md
```

Suggested event shape:

```ts
type HandoffTaskEvent = {
  sequence: number;
  task_id: string;
  type: "handoff";
  message_preview?: string;
  artifact_path?: string;
  created_at: string;
};
```

Processing order:

1. Verify that the target task is steerable before accepting a handoff as delivered.
2. Read `--message_file` or message body.
3. Write the handoff artifact.
4. Inject a clearly marked HANDOFF block into the target task's pane.
5. Append `task_events.type = "handoff"` with preview and artifact reference only after injection succeeds.

If injection fails, return a steering error and do not append a `handoff` event that could be mistaken for receipt. The first slice may leave an unreferenced temporary artifact only if cleanup is impractical, but normal operation should avoid durable references for undelivered handoffs.

Injected message format should make the intent obvious:

```text
[HANDOFF]
The following is context transfer for this running task. Read it, summarize your understanding if useful, and continue from the current state.

<content>
```

## State reading for mid-flight intervention

An agent cannot safely intervene if it cannot understand the current situation. The MVP should provide a task-level context snapshot rather than a new session API.

```sh
cuekit task snapshot --task_id t_parent
```

or, if avoiding a new command name is preferred:

```sh
cuekit task status --task_id t_parent --include-context
```

The recommended surface is `task snapshot` because it is explicit and task-scoped.

The first implementation should be deterministic. It does not need LLM summarization.

Suggested snapshot contents:

```ts
type TaskSnapshot = {
  task_id: string;
  status: string;
  agent_kind: string;
  role?: string;
  objective?: string;
  cwd?: string;
  metadata?: unknown;
  last_activity_at?: string;
  latest_events: TaskEvent[];
  latest_handoffs: Array<{
    sequence: number;
    message_preview?: string;
    artifact_path?: string;
    created_at: string;
  }>;
  related_teams?: TeamSummary[];
  related_tasks?: TaskSummary[];
  transcript_tail?: string;
  suggested_next_read_actions?: string[];
};
```

For parent session tasks, the snapshot should help a third-party agent answer:

- What is this parent agent managing?
- What happened recently?
- Were any handoffs injected?
- Which teams/tasks appear related?
- Is the task running, stale, blocked, or terminal?
- What should I inspect next before steering?

Related teams/tasks can be added in stages. The simplest first slice may list teams/tasks referenced in recent event payloads or task metadata. If parent-child linkage becomes common, add a lightweight `parent_task_id` reference later; do not add it before a concrete query path requires it.

## Multiplexer backend compatibility

Parent session tasks must use the same pane/multiplexer abstraction as ordinary interactive tasks. They should not introduce tmux-specific or zellij-specific logic.

Compatibility rules:

- Parent sessions are spawned through the configured pane adapter and active `MultiplexerBackend`.
- The persisted pane handle's `backend_kind` decides future attach, steer, capture, and cleanup behavior for that task.
- TUI attach and live output must use backend-derived attach/capture operations, not hard-coded `tmux` commands.
- Handoff injection is implemented through the same steering path as ordinary `steer_task`, so it works with tmux or zellij when the target task supports steering.
- Transcript artifacts remain under the existing task path, for example `<worktree>/.cuekit/tasks/<task_id>/transcript.txt` and `.cuekit/tasks/<task_id>/handoffs/<sequence>.md`, independent of the multiplexer backend.
- Switching the configured backend does not migrate already-running parent session tasks. Existing tasks keep using the backend recorded in their pane handle.

This aligns parent sessions with [`cuekit-multiplexer-backend-design.md`](cuekit-multiplexer-backend-design.md): parent sessions are a task-level convention, not a new terminal-control layer. Any future TUI Parent Sessions view should reuse the same backend-aware attach/live-pane helpers as the normal task cockpit.

## Timeout and lifecycle behavior

Parent session tasks are long-lived. They should not be auto-timed-out by default.

Rules for `metadata.long_lived == true`:

- default task runtime timeout is disabled or set to no timeout,
- `wait` should not imply that completion is expected,
- `result` is less important than `status`, `events`, `transcript`, and `snapshot`,
- shutdown is explicit through cancel/delete/cleanup,
- stale/idle detection should be observational, not automatic termination.

Normal bounded worker/reviewer/coordinator tasks keep their normal timeout policy.

If a caller explicitly supplies a timeout for a parent session task, cuekit may honor it, but the generated TUI/default parent-session path should not set one.

## TUI design

Do not add a session API, but do make the human TUI present parent-session tasks as sessions.

### Parent Sessions view

Add a filtered view over tasks where:

```text
metadata.run_kind == "parent_session"
```

Example:

```text
Parent Sessions
- t_123  running  pi          repo-a  last active 3m ago
- t_456  running  claude-code repo-b  last active 1h ago
```

Available actions can reuse task actions:

- attach
- steer
- send handoff
- view snapshot
- view transcript
- cancel/stop

### New Parent Session

Add a TUI action for creating a parent session task:

```text
New Parent Session
  Agent: pi / claude-code / gemini / ...
  Role/Profile: parent
  CWD: current project
  Initial objective: optional
  Start and attach: yes
```

Internally this calls task submit with:

```json
{
  "role": "parent",
  "metadata": {
    "run_kind": "parent_session",
    "long_lived": true
  },
  "timeout_ms": null
}
```

If the initial objective is empty, use only the parent bootstrap prompt and instruct the agent to wait for user input.

This updates the earlier TUI non-goal of "new task submission from the TUI" in a narrow way: general task submission can remain out of scope, while a specialized parent-session creation flow is allowed because it is part of the human attach workflow.

## AI/operator guidance

Documentation and prompts should teach this compact rule:

```text
To create a managed parent session, submit an interactive long-lived task with role=parent and metadata.run_kind="parent_session".
```

For intervention:

```text
Read task snapshot/status/events/transcript first. Then steer the task only if intervention is useful. Use `event_type: "handoff"` when transferring substantial context.
```

For handoff bodies, recommend a simple Markdown shape:

```md
# HANDOFF

## Context

## Completed

## Current State

## Open Questions / Risks

## Recommended Next Actions

## Related cuekit Objects
```

## Compatibility with cuekit scope

This design keeps cuekit as a delegation and result-normalization substrate:

- parent sessions are still tasks,
- durable state remains in `task_events`,
- handoffs are explicit user/agent actions, not automatic delivery,
- snapshots are read/query surfaces, not scheduler behavior,
- no workflow engine or auto-steer loop is introduced.

## MVP implementation checklist

1. Define/recognize the `metadata.run_kind = "parent_session"` and `metadata.long_lived = true` convention.
2. Add or document a `parent` agent profile.
3. Ensure parent-session submissions default to interactive mode and no runtime timeout.
4. Add `handoff` as a valid task event type.
5. Add `--message_file` support to task steering.
6. Add `--event_type handoff` support to task steering for steerable tasks.
7. Store handoff bodies as task artifacts and event previews/references in `task_events`.
8. Add deterministic `task snapshot` or `task status --include-context`.
9. Add TUI Parent Sessions filter/view.
10. Add TUI New Parent Session flow that submits and optionally attaches.

## Future options

Only add a real `session` API if usage proves that task terminology harms human or AI operation. If added, it should be a thin alias over parent-session tasks:

```text
session start      -> task submit + parent metadata
session attach     -> status-provided attach_command / TUI attach
session steer      -> steer task
session status     -> task status/snapshot
session transcript -> task transcript
session stop       -> task cancel
```

Other possible future additions:

- parent-task linkage for teams/tasks when snapshot queries need it,
- richer TUI handoff composer,
- deterministic stale/idle indicators in snapshots,
- optional LLM-generated summaries outside the core store contract,
- remote/user identity and permissions if cuekit moves beyond single-user local control.
