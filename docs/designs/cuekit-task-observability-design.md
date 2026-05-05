# cuekit Task Observability Design

## Status

Draft design note.

## Problem

cuekit task teams already give each child task a separate adapter process, tmux pane, reporting token, transcript reference, and durable `task_events` stream. That is enough to coordinate work, but team runs can still be hard to judge from summaries alone:

- a parent or coordinator cannot quickly see which files a child claims to have read or changed,
- a reviewer may read a file before another worker changes it and then report against stale context,
- timeouts currently explain that a task timed out, but not as a durable child-report-style diagnostic event, and
- adding a rich tracing subsystem now would add complexity before the minimum useful contract is proven.

Hermes Agent's delegation model shows the value of child observability, but cuekit should keep its first slice simple and event-first: children report useful facts through the existing reporting channel, and team summaries aggregate those facts.

## Goals

- Improve team/strategy result readability without introducing a new scheduler or tracing system.
- Let child tasks optionally self-report the main files they read or wrote.
- Surface timeout diagnostics through the same `task_events` stream as normal child reports.
- Warn, conservatively, when team tasks both read and write the same paths.
- Preserve backward compatibility for arbitrary `payload` values in `report_task_event`.

## Non-Goals

- No database migration in the first slice.
- No dedicated file-event table.
- No automatic transcript parsing.
- No automatic file read/write tracking.
- No token, API-call, current-tool, or output-tail aggregation yet.
- No strict chronological stale-read proof in the first slice.
- No automatic steering or cancellation based on observability warnings.

## Minimal Payload Contract

`report_task_event.payload` remains arbitrary JSON. cuekit only recognizes a small optional shape when present:

```ts
type TaskObservabilityPayload = {
  phase?: string;
  files?: {
    read?: string[];
    written?: string[];
  };
  diagnostic?: {
    kind: "timeout" | "stale" | "pane_disappeared";
    message?: string;
  };
};
```

Compatibility rules:

- Unknown payload shapes are still stored exactly as before.
- Invalid observability fields are ignored for aggregation, not rejected.
- `files.read` and `files.written` only interpret string arrays.
- Empty paths are ignored.
- Duplicate paths are removed.
- Path normalization stays intentionally light; the first slice should not try to prove that every spelling of a path is equivalent.

Example child report payload:

```json
{
  "phase": "testing",
  "files": {
    "read": ["packages/mcp/src/team-run-summary.ts"],
    "written": ["packages/core/src/task-observability.ts"]
  }
}
```

## Core Helper

Add a small core helper, for example `packages/core/src/task-observability.ts`, with no store or MCP dependency.

Responsibilities:

- safely extract the recognized observability fields from `unknown`,
- normalize simple string lists by removing empty values and duplicates,
- collect read/written file sets from event payloads, and
- collect diagnostic entries from event payloads.

This helper should be deliberately small. It should not own team semantics, stale-warning policy, DB queries, or adapter behavior.

## Reporting Prompt Update

The child reporting contract in `packages/adapters/src/task-spec-prompt.ts` should mention the optional payload briefly:

```text
When useful, include simple observability payloads, for example:
{"phase":"testing","files":{"read":["src/a.ts"],"written":["src/a.ts"]}}
```

Guidance should remain soft:

- do not require every report to include file lists,
- do not ask children to produce perfect file inventories,
- prefer the main files relevant to review and coordination, and
- keep terminal reports concise.

## Timeout Diagnostic Event

When `packages/adapters/src/pane-adapter.ts` detects a task timeout, it should append a `log` event before or alongside the terminal transition:

```json
{
  "diagnostic": {
    "kind": "timeout",
    "message": "timed out after 600000ms"
  }
}
```

The task status remains `timed_out`. The diagnostic event makes the timeout visible through the same event/result surfaces that team coordinators already inspect.

The first slice may limit adapter-generated diagnostics to timeouts. `pane_disappeared` can be added later if the minimal contract proves useful.

## Team Run Summary Aggregation

Extend `TeamRunSummary` with an optional `observability` block. Omit the block when it would be empty.

Suggested shape:

```ts
type TeamRunObservabilitySummary = {
  files_read: string[];
  files_written: string[];
  diagnostics: Array<{
    task_id: string;
    kind: string;
    message?: string;
  }>;
  warnings?: Array<{
    kind: "stale_read";
    message: string;
    paths: string[];
  }>;
};
```

Aggregation rules:

1. Iterate over each task's `task_events`.
2. Parse each event payload with the core helper.
3. Union all recognized `files.read` values into `files_read`.
4. Union all recognized `files.written` values into `files_written`.
5. Add recognized diagnostics with the owning `task_id`.
6. If `files_read` and `files_written` intersect, emit one conservative warning.

The stale warning is intentionally not a correctness verdict. It should say that re-reading may be needed, not that the review is invalid.

Example warning:

```json
{
  "kind": "stale_read",
  "message": "Some tasks read files that were also written by team tasks; re-read may be needed.",
  "paths": ["packages/mcp/src/team-run-summary.ts"]
}
```

## Result Surfaces

`get_team_status` and any `get_team_result` path that includes `run_summary` should expose the new `observability` block through `run_summary`.

Task-level result surfaces can remain unchanged in the first slice unless they already expose raw events. The team summary is the highest-value surface because stale-read warnings only become meaningful across multiple tasks.

## Testing

Minimum tests:

- core helper parses valid payloads and ignores invalid observability fields,
- file lists are deduplicated and empty paths are ignored,
- team run summary aggregates files and diagnostics across task events,
- team run summary emits a conservative stale-read warning for read/write intersection,
- team run summary omits `observability` when empty, and
- pane timeout appends a diagnostic event and still marks the task `timed_out`.

## Future Extensions

Only add these after the minimal payload contract proves useful:

- stricter path normalization,
- chronological stale-read checks using event timestamps,
- task-level observability summaries,
- token/API-call/current-tool fields,
- adapter-specific transcript parsers,
- TUI rendering for files and diagnostics,
- automatic coordinator steer suggestions for stale or stuck tasks.
