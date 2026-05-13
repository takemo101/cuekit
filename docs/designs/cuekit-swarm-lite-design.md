# Design: Swarm-lite team coordination

## Status

Proposed design note.

## Context

cuekit already supports task teams, coordinator-led strategies, durable `task_events`, typed handoffs, attention items, and terminal multiplexers such as tmux, Zellij, and Herdr. These primitives make parallel child-agent work possible, but the parent/coordinator still has to read several surfaces to understand team state.

jcode's proposed swarm architecture shows a much larger runtime direction: a single daemon owns sessions, agent-to-agent DMs, channels, broadcasts, plan objects, file-touch notifications, soft-interrupt delivery, and optional worktree managers. cuekit should not copy that whole model. cuekit's durable value is a small parent-led delegation substrate that makes child agents observable and steerable without becoming a workflow engine or swarm OS.

This design defines the next safe slice: **Swarm-lite**. It improves team coordination and parallel work by making state easier to read and important context easier to report, while keeping the parent/coordinator responsible for judgment and intervention.

## Problem

Current team workflows can become harder to coordinate as teams grow:

- team status, team result, task snapshots, handoffs, and attention items are useful but spread across multiple reads;
- workers can report findings or blockers, but there is no concise team-level blackboard for shared facts;
- coordinators and reviewers need clear guidance about what shared context to read before acting;
- broad `steer_team` broadcasts are sometimes too coarse; and
- pursuing full swarm parity risks adding DM/channels/schedulers/auto-wake behavior that would make cuekit harder for AI agents to use safely.

## Design goal

Add a small set of coordination affordances that answer one question:

> Does this help the parent or coordinator decide the next action?

Swarm-lite should:

- preserve cuekit's parent-led model;
- make team state readable from one recommended snapshot surface;
- provide a minimal shared team context/blackboard;
- strengthen typed handoffs and role/profile guidance;
- support targeted manual steering where useful;
- keep MCP/CLI surface area grouped and discoverable; and
- avoid automatic scheduling, notification delivery, or agent-to-agent runtime complexity.

## Non-goals

Swarm-lite explicitly does **not** include:

- jcode-style full swarm runtime;
- peer-to-peer agent DMs;
- channels or group chats;
- server-injected running-agent notifications;
- automatic coordinator wake/resume;
- automatic steering;
- plan DAG execution;
- workflow scheduling;
- lock-based or automatic conflict resolution;
- read/unread/ack state;
- a separate swarm daemon;
- mandatory worktree managers; or
- automatic tool-intent/file-touch capture in the first slice.

These features may be powerful, but they would move cuekit toward a workflow engine. They require separate designs and concrete evidence before consideration.

## Naming

Use **team** in public API and documentation. Use **Swarm-lite** only as an architectural shorthand.

Rationale:

- `team` matches existing cuekit primitives.
- `swarm` implies autonomous peer coordination and automatic routing.
- cuekit's desired behavior is coordinated parallel delegation, not an independent swarm OS.

## Proposed shape

Swarm-lite has four small pillars:

1. **Team Snapshot** — the recommended read path for parent/coordinator decisions.
2. **Team Blackboard** — minimal typed team-level events/notes for shared facts.
3. **Cooperative Agent Profiles** — builtin role prompts that teach agents what to read/report.
4. **Targeted Manual Steering** — selective steering convenience without auto-routing.

Each pillar can ship independently.

## Pillar 1: Team Snapshot

### Purpose

A grouped `get({ kind: "team_snapshot" })` surface should be the first surface a parent/coordinator reads before deciding whether to wait, steer, submit follow-up tasks, request review, or finish. A compatibility helper named `get_team_snapshot` can exist during the prototype window if needed, but the AI-facing direction should follow ADR 002's grouped MCP surface.

It is a read model over existing state first. The initial slice should avoid a migration.

### Suggested contents

```ts
type TeamSnapshot = {
  team_id: string;
  title: string;
  objective?: string;
  status: TeamStatus;
  generated_at: string;

  members: Array<{
    task_id: string;
    position?: TeamPosition;
    role?: string;
    agent_kind?: string;
    status: TaskStatus;
    summary?: string;
    updated_at: string;
  }>;

  positions: Partial<Record<TeamPosition, Array<{
    task_id: string;
    status: TaskStatus;
    last_report?: string;
    updated_at: string;
  }>>>;
  recent_events: TeamTimelineEvent[];
  attention_items: TeamAttentionItem[];
  latest_handoffs: Array<{
    task_id: string;
    position?: TeamPosition;
    event_id: string;
    sequence: number;
    message_preview?: string;
    artifact_path?: string;
    created_at: string;
  }>;
  observability?: TeamRunObservabilitySummary;

  open_questions?: string[];
  blockers?: Array<{
    task_id: string;
    position?: TeamPosition;
    message: string;
  }>;

  guidance: {
    recommended_next_reads?: string[];
    manual_steer_hints?: Array<{
      attention_sequence?: number;
      task_id: string;
      target:
        | { kind: "task"; task_id: string }
        | { kind: "team"; team_id: string }
        | { kind: "team_position"; team_id: string; position: TeamPosition }
        | { kind: "team_tasks"; team_id: string; task_ids: string[] };
      tool: "steer";
      suggested_message?: string;
    }>;
    suggested_next_actions?: string[];
  };
};
```

`latest_handoffs` is a team aggregation of already-delivered task handoff events, using the same artifact/preview semantics as `get_task_snapshot`. If no delivered handoff events exist, it is an empty array; Phase 1 must not invent undelivered handoff state.

`guidance.suggested_next_actions` must be plain guidance, not an executable plan. Examples:

- `Inspect blocked worker t_123 before waiting again.`
- `Review attention item 42 before submitting a finisher.`
- `All workers completed; consider submitting a reviewer.`

### Relationship to existing surfaces

- `get_team_status` remains compact status.
- `wait_team` remains bounded polling.
- `get_team_result` remains the terminal/audit result.
- grouped `get({ kind: "team_snapshot" })` becomes the high-signal decision surface for in-progress work.

## Pillar 2: Team Blackboard

### Purpose

Some information is team-level rather than task-terminal:

- a finding discovered by one worker that affects others;
- a decision made by the coordinator;
- a blocker that should be visible without reading a transcript;
- a review result that a finisher should inspect.

Delivered handoffs remain task-level `task_events.type = "handoff"` created through steering after successful injection. The blackboard should not introduce a second team-level `handoff` event type, because that would make it ambiguous whether a handoff was delivered to a running task or merely recorded as a team note.

A minimal blackboard should store typed team events, not mutable documents or chat channels.

### Minimal event types

Start with a small closed set:

```ts
type TeamEventType =
  | "finding"
  | "decision"
  | "blocker"
  | "review_result";
```

Avoid adding more types until real workflows require them. Free-form `payload_json` can carry details without expanding the public enum.

### Suggested storage

A future migration can add:

```sql
create table team_events (
  id text primary key,
  team_id text not null,
  task_id text,
  position text,
  event_type text not null,
  message text not null,
  payload_json text,
  created_at text not null,
  foreign key(team_id) references task_teams(id) on delete cascade,
  foreign key(task_id) references tasks(id) on delete set null
);

create index idx_team_events_team_id_created_at on team_events(team_id, created_at);
```

Rules:

- append-only in the first slice;
- no ack/read state;
- no delivery queue;
- no automatic injection into running agents;
- task linkage is optional because parents or external actors may report team-level context.

### MCP/CLI surface

Do not add many one-off tools. Prefer a future grouped reporting surface rather than overloading the existing task-scoped `report_task_event` contract:

```json
report({
  "kind": "team_event",
  "team_id": "tm_...",
  "event_type": "finding",
  "message": "Parser and CLI disagree on the default timeout.",
  "task_id": "t_...",
  "payload": { "files": ["packages/mcp/src/..."] }
})
```

Until such a grouped `report` surface exists, implementations should either keep team blackboard out of scope or add one clearly transitional operation with a documented migration path. `report_task_event` should remain task-scoped so child reporting semantics stay simple and compatible with ADR 001.

## Pillar 3: Cooperative Agent Profiles

Swarm-lite quality depends more on role behavior than runtime machinery. Builtin profiles should encode cooperative reporting habits.

### Coordinator

Coordinator guidance should say:

- read grouped `get({ kind: "team_snapshot" })` before major decisions;
- inspect `attention_items`, blockers, and handoffs before waiting or finishing;
- record important decisions as team events;
- submit reviewers/finishers only when useful;
- steer manually and selectively when a worker is blocked or stale; and
- produce a final report grounded in team events/results.

### Worker

Worker guidance should say:

- report terminal outcome through the normal task reporting path;
- report important findings, blockers, and changed assumptions concisely;
- include relevant files in observability payloads when useful;
- avoid over-reporting noise; and
- do not spawn or stop other agents unless explicitly instructed by the coordinator/parent.

### Reviewer

Reviewer guidance should say:

- read the team snapshot, handoffs, and relevant findings before reviewing;
- report actionable issues with severity;
- distinguish blocking correctness issues from optional polish;
- include stale-read caveats when files changed after inspection; and
- emit `review_result` when team-level blackboard support exists.

### Finisher

Finisher guidance should say:

- inspect worker/reviewer terminal reports, attention items, and handoffs;
- verify requested evidence before PR/release/report-back work;
- avoid taking PR/merge actions unless explicitly requested;
- record final evidence in the terminal report; and
- leave cleanup decisions explicit.

These are prompt conventions, not permission enforcement.

## Pillar 4: Targeted Manual Steering

The existing grouped `steer` surface already supports task/team steering, with `steer_task` and `steer_team` kept as compatibility aliases during the prototype window. Swarm-lite should extend that grouped surface with smaller manual scopes only if broad team broadcast proves too coarse.

Possible future target filters:

```ts
type TeamSteerTarget =
  // Existing grouped steer kinds.
  | { kind: "team"; team_id: string }
  | { kind: "task"; task_id: string }
  // Possible future scoped team kinds.
  | { kind: "team_position"; team_id: string; position: TeamPosition }
  | { kind: "team_tasks"; team_id: string; task_ids: string[] };
```

Rules:

- steering remains manually initiated by a parent/coordinator;
- no automatic routing from attention items;
- no unread/ack semantics;
- batch/non-steerable tasks should continue to return steering-unsupported errors;
- callers should read grouped `get({ kind: "team_snapshot" })` or `get_task_snapshot` before steering.

## Comparison with jcode swarm

Swarm-lite intentionally targets a smaller equivalence class.

| Capability | jcode-style swarm | cuekit Swarm-lite |
| --- | --- | --- |
| Many agents in parallel | yes | yes, via teams/adapters/multiplexers |
| Shared status snapshot | daemon snapshot | grouped `get({ kind: "team_snapshot" })` read model |
| Shared context | shared keys/channels | append-only team events/blackboard |
| Direct agent DMs | yes | no |
| Channels/broadcast chat | yes | no; manual steer only |
| Running notification injection | soft interrupts | no auto-injection |
| Plan DAG | planned graph | no scheduler/DAG executor |
| Worktree manager | explicit role | optional future, not built-in |
| Conflict detection | file touch/intent | self-reported observability and manual review |
| Primary control | runtime/server | parent/coordinator via MCP/CLI |

The goal is not complete jcode parity. The goal is enough parallel coordination for coding-agent delegation while retaining cuekit's small, inspectable control plane.

## Implementation phases

### Phase 1: Snapshot-first, no migration

- Add grouped `get({ kind: "team_snapshot" })` as the preferred AI-facing surface, with a temporary compatibility helper only if needed.
- Aggregate existing team status, recent task events, attention items, handoffs, and observability.
- Add guidance-only next-action hints.
- Update coordinator/profile prompts to prefer snapshot reads.

This phase should be the default starting point because it reduces complexity while improving coordination.

### Phase 2: Minimal team blackboard

- Add `team_events` storage.
- Add a minimal report path for `finding`, `decision`, `blocker`, and `review_result`.
- Include blackboard entries in team snapshot and team result.
- Keep events append-only and delivery-free.

### Phase 3: Profile cooperation update

- Update builtin coordinator, worker, reviewer, and pr-finisher profiles.
- Keep profile language concise and operational.
- Ensure prompts discourage auto-spawn/auto-stop behavior unless explicitly assigned.

This can happen before or alongside Phase 2 if it only references existing reporting paths.

### Phase 4: Targeted steering

- Add position/task-subset steering filters.
- Surface manual steer hints from snapshot.
- Keep `steer_task` and existing `steer_team` compatibility aliases if needed.

### Phase 5: TUI visibility

- Add a team snapshot/blackboard view to the TUI.
- Show attention, blockers, latest handoffs, and recent team events.
- Do not add chat UX, ack state, or auto-actions.

## Complexity budget

A proposed Swarm-lite feature should be rejected or split if it requires any of the following in its first slice:

- a scheduler;
- delivery state;
- automatic wake/steer;
- agent-to-agent routing;
- conflict locks;
- independent daemon semantics;
- new long-lived background workers; or
- more than one or two new user-facing operations.

The preferred pattern is:

1. derive from existing state;
2. expose a read model;
3. add append-only events only when reads are insufficient;
4. improve profile guidance; and
5. leave decisions manual.

## Open questions

- Is grouped `get({ kind: "team_snapshot" })` discoverable enough for AI callers, or is a temporary compatibility helper needed during the prototype window?
- Should team blackboard events reuse `task_events` with `team_id`, or use a separate `team_events` table for clearer semantics?
- How much summary text should snapshot compute deterministically before requiring LLM-generated summaries?
- Should targeted steering be introduced before blackboard if broad broadcasts become the bigger real-world pain?

## Recommendation

Proceed with **Phase 1 only** as the first implementation PR after this design is accepted. It gives immediate value, requires no new durable state, and tests whether one high-signal snapshot surface is enough before adding blackboard storage or more steering controls.
