# 001: Child Reporting Surface (2026-04-29)

## Problem

cuekit runs child coding agents in interactive multiplexer panes so a human or parent agent can attach, observe, and steer them. This preserves native agent UX, but it creates an ambiguous completion problem: an interactive child may finish its answer and return to its own prompt while the pane remains alive, so cuekit still sees the task as `running`.

Relying only on transcript parsing or child-written `result.json` files would be brittle. It would also make structured progress, files changed, test evidence, blocked states, and parent-help requests hard to capture consistently across Claude Code, pi, OpenCode, and future adapters.

## Decision

cuekit will add a **child-facing reporting surface**. Child agents report progress and outcomes through cuekit operations rather than writing the canonical result state directly.

The preferred reporting order for child agents is:

1. **MCP reporting tools**, when available to the child runtime.
2. **CLI fallback commands** under `cuekit tool ...`, when MCP is unavailable.

Transcript markers are not part of the reporting contract. They are not planned while MCP or the CLI is available; reconsider them only if a concrete recovery need appears.

Canonical task state and child reports live in SQLite. The durable inbox is a single `task_events` stream; a separate `parent_notifications` table, push delivery tracking, and subscription API are **not planned** unless concrete UX needs prove `task_events` polling/listing insufficient. Large outputs remain file artifacts referenced from SQLite.

## Scope

This is a post-v0 / v2 design target. It should not be treated as required for the current minimal v0 lifecycle until the child-facing store fields, handlers, and adapter environment injection are implemented. Adapter shutdown orchestration is not part of the reporting design.

## Proposed child-facing operation

Keep the first child-facing API intentionally small: one generic report operation that appends a structured event and, for terminal report types, updates task status through the store.

CLI shape:

```sh
cuekit tool report --type progress --message "Running targeted tests" --payload '{"phase":"testing"}'
cuekit tool report --type completed --message "Implemented retry logic"
cuekit tool report --type failed --message "Tests failed"
cuekit tool report --type blocked --message "Need product clarification"
cuekit tool report --type help_requested --message "Which migration should I use?"
```

MCP projection uses the same handler and schema, with a stable flat name such as:

- `report_task_event`

Convenience aliases such as `complete_task`, `block_task`, or `request_parent_help` are not planned initially; add them only if real model behavior shows the generic `report_task_event` is insufficient. General artifact registration remains out of scope until cuekit has an artifacts table or artifact-list field; reports may only reference existing result/transcript refs or include small JSON payloads.

The CLI can infer `task_id` and authorization from environment variables injected by the adapter:

```sh
CUEKIT_TASK_ID=t_abc
CUEKIT_CHILD_TOKEN=ck_child_...
```

## Completion and shutdown semantics

For the simplified reporting contract, completion reporting and runtime shutdown are separate concerns.

Calling `report_task_event(type=completed)` or `cuekit tool report --type completed` records the child-declared terminal event in `task_events` and may update the task row to `completed` through normal store status transitions. It does not require cuekit to prove that the interactive pane/process has exited first.

Recommended flow:

```text
running
  -> child reports completed/failed/blocked
task_events append + task status update to the reported terminal kind
  -> optional adapter/shared-pane shutdown policy may later send /exit or equivalent
terminal session eventually exits or remains attachable, independent of report persistence
```

For `failed` and `blocked`, the reported terminal kind is also stored directly. A later clean pane exit must not rewrite an explicit failure/block report into success.

Graceful-shutdown orchestration is not planned as part of child reporting. If a separate runtime lifecycle feature is ever added, it must remain an optional layer over the durable report/event model rather than a prerequisite for recording completion.

## Child skill

cuekit should ship a child-agent skill that explains the reporting contract. The skill should tell children to:

- report meaningful progress during long work
- call `report_task_event` / `cuekit tool report --type completed` before finishing successfully
- report `failed`, `blocked`, or `help_requested` as appropriate
- prefer MCP tools when available
- fall back to `cuekit tool ...` CLI commands
- do not rely on transcript markers as a normal reporting path

This skill becomes the UX contract for child agents. Adapters remain responsible for environment injection. Runtime-specific graceful-shutdown input is not part of the reporting contract.

## References

- isuner: completion/error marker detection and sweep-style repair patterns.
- pi-interactive-subagents: child-written activity snapshots, `subagent_done`, `caller_ping`, and auto-exit behavior.

## Consequences

### Benefits

- Keeps tmux/interactive execution useful while enabling structured completion.
- Avoids transcript parsing as the primary result path.
- Works for children with MCP access and children with only shell/CLI access.
- Preserves cuekit's schema-backed CLI/MCP parity.
- Enables richer progress and result reporting without making cuekit a workflow engine.
- Keeps the first child-reporting implementation small by using one report API and one `task_events` inbox.

### Costs / follow-up

- Requires child-token authorization so one child cannot update unrelated tasks.
- Requires a `task_events` table and minimal store logic for terminal report status updates.
- Requires adapter support for injecting env vars.
- Requires a child-facing skill and prompt injection strategy.
- Does not implement direct parent push/subscriptions, transcript marker parsing, or advanced graceful shutdown confirmation unless later evidence proves they are needed.
