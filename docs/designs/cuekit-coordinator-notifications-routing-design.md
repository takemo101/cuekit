# Design: Coordinator notifications and report-back routing

## Status

Foundation implemented: `position: finisher` is a first-class team position, team status/result summaries group finisher events separately, and coordinator prompts include finisher report-back guidance. Future event-listing or notification views remain design guidance only.

## Problem

Coordinator-led teams currently rely on bounded waits, explicit `get_team_status` / `get_team_result` inspection, and durable child reports in `task_events`. That keeps cuekit simple, but it also means a coordinator can miss an important worker, reviewer, or finisher report unless it polls or the parent steers it.

The new first-class `position: finisher` direction gives cuekit a clearer terminal handoff point than `position: reviewer` + `role: pr-finisher`. It should also be the anchor for any later coordinator notification or report-back routing design: finishers are not just another reviewer; they are the team slot most likely to produce final PR/merge/sync evidence that the coordinator must inspect before the coordinator's final report.

## Design Goal

Add a durable, guidance-first report-back path that helps coordinators notice important team events, especially finisher terminal reports, without turning cuekit into an auto-steering swarm runtime.

The design should:

- build on `position: finisher` as a first-class `TeamPosition`,
- preserve `task_events` as the canonical durable report stream,
- make team summaries and `get_team_result` clearly surface finisher events separately from reviewers,
- guide coordinators to inspect finisher results before final completion,
- avoid separate push/ack/subscription infrastructure until concrete UX needs require it, and
- defer automatic coordinator wake/resume/steer behavior.

## Non-Goals

- No automatic coordinator wake/resume in this slice.
- No auto-steer rules such as "when worker completes, tell coordinator to continue".
- No declarative routing engine or DAG.
- No separate `parent_notifications` table, delivery queue, ack table, websocket subscription, or push service.
- No permission model where `finisher` can bypass coordinator/user approval.

## Proposed Direction

### 1. Make finisher addressable in durable summaries

Because `finisher` is a valid team position, team status/result surfaces group it independently:

```ts
type TeamPosition = "coordinator" | "worker" | "reviewer" | "finisher" | "observer";
```

`get_team_status.run_summary.positions.finisher` and `get_team_result` should include concise durable events from finisher tasks. This lets a coordinator and parent distinguish:

- reviewer approval or findings (`position: reviewer`), from
- PR/merge/sync/cleanup evidence (`position: finisher`).

This is an aggregation and display change, not a routing mechanism.

### 2. Keep the durable inbox as `task_events`

Report-back routing should start as a filtered view over existing events:

- child tasks call `report_task_event`,
- events are stored durably in SQLite `task_events`,
- team status/result APIs summarize events by team position, and
- coordinators are prompted to inspect `get_team_result` after any finisher task completes.

This continues ADR 001's direction: do not add `parent_notifications`, push delivery tracking, or ack state until event polling/listing proves insufficient.

### 3. Guidance before automation

Coordinator prompt guidance should say, in substance:

```text
When a finisher task reports completed/failed/blocked, inspect get_team_result before producing your own terminal report. Treat the finisher report as final-flow evidence to integrate, not as an automatic team completion trigger.
```

The parent/caller can still steer a coordinator if it remains idle. Cuekit should not wake or auto-steer the coordinator in this design slice.

### 4. Future durable notification view, if needed

If direct event polling becomes noisy, add a derived query or view over `task_events`, not a new delivery system. For example:

```ts
list_team_events({
  team_id,
  positions: ["finisher", "reviewer"],
  terminal_only: true,
  since_cursor,
})
```

`since_cursor` means an opaque stable event cursor defined by that future query surface; it should not expose storage internals unnecessarily. Such a view would be durable and replayable. It would still not imply push delivery, ack tracking, or automatic coordinator action.

## Relationship to Existing Designs

- [Task teams design](cuekit-task-teams-design.md): extends the `TeamPosition` set with `finisher` and keeps teams as grouping/status/event primitives.
- [Team strategies design](cuekit-team-strategies-design.md): strategy `recommended_team.finisher` slots should use `position: finisher` and `role: pr-finisher`.
- [PR finisher profile design](cuekit-pr-finisher-profile-design.md): the `pr-finisher` Agent Profile remains the specialized release/PR checklist; `finisher` is the team position that makes that phase visible.
- [ADR 001](../decisions/001-child-reporting-surface.md): durable reports remain in `task_events`; separate notification queues stay out of scope.

## Implemented Foundation

- Schemas and grouping helpers accept `finisher` as a `TeamPosition`.
- Team status/result tests cover `run_summary.positions.finisher` separately from `reviewer`.
- Strategy schema/project config examples allow `position: finisher`.
- Coordinator prompt rendering mentions finisher report-back inspection.

## Future Implementation Notes

- The recommended next slice is [Team attention items](cuekit-team-attention-items-design.md): a derived important-event summary over `task_events` for `get_team_status`, `wait_team`, and `get_team_result`.
- Keep any future event-listing enhancements read/query-oriented before considering wake/steer behavior.
- If a `list_team_events` query is added, use an opaque cursor and keep `task_events` as the canonical durable stream.
- Do not add separate delivery queues, ack state, push subscriptions, or automatic coordinator actions without a new design slice.
