# Design: Team attention items

## Status

Draft design note for the next Swarm-lite UX slice after first-class `position: finisher`. This is design guidance only; no implementation is included in the current slice.

## Problem

Cuekit teams already persist worker, reviewer, coordinator, and finisher reports in `task_events`. `get_team_status`, `wait_team`, and `get_team_result` expose those reports by position and timeline, which is enough to run Swarm-lite workflows.

The remaining UX problem is discoverability: as team timelines grow, a parent or coordinator can miss the small set of events that require attention, such as a blocked worker, reviewer failure, help request, or finisher terminal report.

Cuekit should make those important events easier to see without becoming a notification delivery system or scheduler.

## Design Goal

Add **attention items** as a derived, read-only summary of important team events.

Attention items should:

- be derived from existing `task_events`,
- require no new durable table, ack state, read/unread state, or delivery queue,
- highlight important non-coordinator reports for parents and coordinators,
- keep `position: finisher` visible as the finalization/report-back lane,
- work in `get_team_status`, `wait_team`, and `get_team_result`, and
- remain guidance-first: cuekit does not auto-send messages, auto-steer, or wake coordinators.

## Non-Goals

- No automatic coordinator wake/resume.
- No automatic `steer_task` / `steer_team` call.
- No message injection into coordinator terminals.
- No `parent_notifications` table.
- No ack/read/unread tracking.
- No delivery queue, websocket, subscription, or routing DSL.
- No special permissions for `finisher` tasks.

## Proposed Shape

Attention items are a filtered view of existing team events:

```ts
type TeamAttentionReason = "terminal_report" | "help_requested";

type TeamAttentionItem = {
  sequence: number;
  task_id: string;
  position?: TeamPosition;
  type: "completed" | "failed" | "blocked" | "help_requested";
  reason: TeamAttentionReason;
  message?: string;
  created_at: string;
};
```

Initial extraction rule:

```text
For tasks in the team:
- exclude position: coordinator,
- include event types completed, failed, blocked, help_requested,
- sort by task_events.sequence ascending,
- cap to a small recent limit, e.g. 10 items.
```

This intentionally treats attention items as **important-event excerpts**, not as delivered notifications.

## Surfaces

### 1. Team run summary

`get_team_status` and `wait_team` should include attention items inside `run_summary`:

```ts
run_summary: {
  terminal_reports: 4,
  latest_terminal_message: "...",
  positions: { ... },
  attention_items: [
    {
      sequence: 123,
      task_id: "t_finisher",
      position: "finisher",
      type: "completed",
      reason: "terminal_report",
      message: "PR created and checks are green",
      created_at: "2026-05-05T00:00:00.000Z"
    }
  ]
}
```

### 2. Team result

`get_team_result` should include the same attention item shape next to the full timeline:

```ts
{
  timeline: [...],
  attention_items: [...]
}
```

The full timeline remains the audit trail. Attention items are a concise “look here first” summary.

## Coordinator Guidance

Coordinator prompts should include a short instruction:

```text
When team status or result includes attention_items, inspect them before deciding whether to continue, submit more tasks, steer a task, or emit your final report.
```

This is prompt guidance only. The parent or coordinator remains responsible for deciding whether to steer, wait, submit follow-up work, or finish.

## Relationship to Existing Designs

- Existing `run_summary.open_attention`: tracks currently non-terminal tasks that need attention, such as running or blocked tasks. `attention_items` should be historical/event-based excerpts from `task_events`, including terminal reports and help requests. A later implementation should keep this distinction explicit or rename one surface before shipping if overlap becomes confusing.
- [Task teams design](cuekit-task-teams-design.md): attention items are an event-first team summary, not a scheduler feature.
- [Coordinator notifications and report-back routing](cuekit-coordinator-notifications-routing-design.md): attention items are the recommended next guidance-first step before any notification delivery, auto-steer, or wake design.
- [Team strategies design](cuekit-team-strategies-design.md): strategy prompts should tell coordinators to inspect attention items as part of normal team orchestration.
- [ADR 001](../decisions/001-child-reporting-surface.md): `task_events` remains the canonical durable report stream; no `parent_notifications` table is introduced.

## Implementation Notes for a Later Slice

- Add a small helper, likely `packages/mcp/src/team-attention.ts`, that derives attention items from team tasks and `task_events`.
- Reuse `TeamPositionSchema` and existing task event schemas where possible.
- Keep extraction data-driven by `team_position` and event type; do not special-case `role: pr-finisher`.
- Add tests for worker blocked, reviewer failed, finisher completed, help requested, and coordinator completed excluded.
- Add schema tests for both `run_summary.attention_items` and `get_team_result.attention_items`.
- Keep any future acknowledgement or delivery semantics out of this helper; those require a separate design.
