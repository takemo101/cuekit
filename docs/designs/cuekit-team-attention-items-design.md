# Design: Team attention items

## Status

Foundation implemented: cuekit derives `attention_items` from existing `task_events` and exposes them in team status/wait run summaries and team results. It also exposes advisory `next_action_hint` guidance when only a coordinator is still running after non-coordinator team members are terminal. Delivery, ack/read state, auto-steer, and auto-wake remain out of scope.

## Problem

Cuekit teams already persist worker, reviewer, coordinator, and finisher reports in `task_events`. `get_team_status`, `wait_team`, and `get_team_result` expose those reports by position and timeline, which is enough to run Swarm-lite workflows.

The remaining UX problem is discoverability: as team timelines grow, a parent or coordinator can miss the small set of events that require attention, such as a blocked worker, reviewer failure, help request, or finisher terminal report.

Cuekit should make those important events easier to see without becoming a notification delivery system or scheduler.

A related dogfood finding is that a coordinator can appear idle after workers/reviewers finish. Manual steering works, but the parent needs a substrate-safe signal that the next useful action may be to inspect results and steer the coordinator to finalize.

## Design Goal

Add **attention items** as a derived, read-only summary of important team events.

Attention items should:

- be derived from existing `task_events`,
- require no new durable table, ack state, read/unread state, or delivery queue,
- highlight important non-coordinator reports for parents and coordinators,
- highlight the coordinator-finalization case when non-coordinator members are terminal and only the coordinator is still running,
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
  /** Compatibility alias: full on result surfaces, preview on status/wait summaries. */
  message?: string;
  message_preview?: string;
  full_message?: string;
  steer_target: { task_id: string; event_sequence: number };
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

`get_team_status` and `wait_team` include attention items inside `run_summary`:

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
      message_preview: "PR created and checks are green",
      steer_target: { task_id: "t_finisher", event_sequence: 123 },
      created_at: "2026-05-05T00:00:00.000Z"
    },
    {
      sequence: 124,
      task_id: "t_worker",
      position: "worker",
      type: "blocked",
      reason: "terminal_report",
      message: "Need repo context before continuing",
      message_preview: "Need repo context before continuing",
      steer_target: { task_id: "t_worker", event_sequence: 124 },
      created_at: "2026-05-05T00:01:00.000Z"
    }
  ],
  manual_steer_hints: [
    {
      attention_sequence: 124,
      task_id: "t_worker",
      target: { kind: "task", task_id: "t_worker" },
      tool: "steer_task",
      suggested_message: "Please respond to this blocked attention item..."
    }
  ]
}
```

### 2. Team result

`get_team_result` includes the same attention item shape next to the full timeline:

```ts
{
  timeline: [...],
  attention_items: [
    {
      sequence: 124,
      task_id: "t_worker",
      position: "worker",
      type: "blocked",
      reason: "terminal_report",
      message: "Full terminal/help report text",
      message_preview: "Full terminal/help report text",
      full_message: "Full terminal/help report text",
      steer_target: { task_id: "t_worker", event_sequence: 124 }
    }
  ],
  manual_steer_hints: [
    {
      attention_sequence: 124,
      task_id: "t_worker",
      target: { kind: "task", task_id: "t_worker" },
      tool: "steer_task"
    }
  ]
}
```

The full timeline remains the audit trail. Attention items are a concise “look here first” summary.

### 3. Coordinator finalization hint

When exactly one team member is non-terminal, that member is `position: coordinator`, and at least one non-coordinator member is terminal, `wait_team` and `get_team_result` may include an advisory `next_action_hint`:

```ts
{
  next_action_hint: "Only coordinator task t_coord is still running while worker/reviewer/finisher tasks are terminal. Inspect get_team_result and, if the coordinator has not finalized, steer t_coord to summarize terminal member reports and emit a completed/failed/blocked terminal report. If parent input is still required, the coordinator should explicitly report help_requested instead, but that is not terminal. cuekit will not auto-steer or auto-finalize."
}
```

This hint is deliberately plain text and manual-action oriented. It does not wake, steer, schedule, or mutate coordinator state.

### Message and manual steer semantics

- `run_summary.attention_items[].message` is summary-safe and may be truncated for status/wait surfaces.
- `get_team_result.attention_items[].message` preserves the full event message for audit/result inspection.
- `full_message` is included only on full result surfaces; summary surfaces omit it to keep status/wait compact.
- `message_preview` is always the concise display string when an event message exists, so clients do not need to invent their own preview policy.
- `steer_target` and `manual_steer_hints` are manual convenience pointers a parent/coordinator may inspect before calling `steer_task`; they are not a delivery queue, suggested automatic action, auto-steer trigger, or ack/read state.

## Coordinator Guidance

Coordinator prompts include a short instruction:

```text
When team status or result includes attention_items, inspect them before deciding whether to continue, submit more tasks, steer a task, or emit your final report.
```

This is prompt guidance only. The parent or coordinator remains responsible for deciding whether to steer, wait, submit follow-up work, or finish.

Coordinator profiles and strategy prompts also remind coordinators to report progress after submitting tasks, bounded waits, and steering, and to inspect `get_team_result` and emit a terminal report once non-coordinator tasks are terminal or explicitly accounted for.

## Relationship to Existing Designs

- Existing `run_summary.open_attention`: tracks currently non-terminal tasks that need attention, such as running or blocked tasks. `attention_items` are historical/event-based excerpts from `task_events`, including terminal reports and help requests. Keep this distinction explicit; if overlap becomes confusing in real use, rename or reshape one surface in a later UX slice.
- [Task teams design](cuekit-task-teams-design.md): attention items are an event-first team summary, not a scheduler feature.
- [Coordinator notifications and report-back routing](cuekit-coordinator-notifications-routing-design.md): attention items are the recommended next guidance-first step before any notification delivery, auto-steer, or wake design.
- [Team strategies design](cuekit-team-strategies-design.md): strategy prompts should tell coordinators to inspect attention items as part of normal team orchestration.
- [ADR 001](../decisions/001-child-reporting-surface.md): `task_events` remains the canonical durable report stream; no `parent_notifications` table is introduced.

## Implemented Foundation

- `packages/mcp/src/team-attention.ts` derives attention items from team tasks and `task_events`.
- The extraction is data-driven by `team_position` and event type; it does not special-case `role: pr-finisher`.
- Tests cover worker blocked, reviewer failed, finisher completed, help requested, coordinator completed excluded, sequence ordering, and cap behavior.
- `run_summary.attention_items` and `get_team_result.attention_items` expose the derived items.
- Attention items include `message_preview` for display, optional `full_message` on result surfaces, and `steer_target`/`manual_steer_hints` for manual inspection/steering workflows without automatic delivery semantics.
- Coordinator prompt rendering tells coordinators to inspect attention items before deciding the next action.
- `wait_team` and `get_team_result` expose a manual `next_action_hint` when non-coordinator members are terminal and only the coordinator is still running.

## Future Implementation Notes

- Keep any future acknowledgement or delivery semantics out of the helper; those require a separate design.
- If attention items and `open_attention` feel overlapping in real use, rename or reshape one surface in a dedicated UX slice rather than adding hidden delivery state.
- Do not add auto-steer, auto-wake, push subscriptions, or ack/read state without a new design.
