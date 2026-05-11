# Parent session tasks

Parent sessions are long-lived interactive cuekit tasks for a shared development workspace. They reuse the normal task control plane; there is no separate public `session` CLI or MCP API in the MVP.

See the design note: [`../designs/cuekit-parent-session-task-design.md`](../designs/cuekit-parent-session-task-design.md).

## Model

A parent session is a task submitted with parent role/profile guidance and metadata:

```json
{
  "run_kind": "parent_session",
  "long_lived": true
}
```

The task stays a regular task for listing, status, snapshot, transcript, events, steering, cancellation, and TUI attach. Parent-session UX is a filtered view over tasks whose submitted metadata has `run_kind: "parent_session"`.

## Create

Use task submission, not a session API. Parent sessions should be interactive and long-lived. If project config supplies a default submit timeout, pass `--timeout_ms null` so the parent workspace is not cancelled by that default.

```sh
cuekit task submit \
  --role parent \
  --agent_kind pi \
  --objective "You are a long-lived parent development agent for this project. Wait for user instructions." \
  --metadata '{"run_kind":"parent_session","long_lived":true}' \
  --timeout_ms null
```

MCP callers use the existing `submit_task` operation with equivalent fields:

```json
{
  "role": "parent",
  "agent_kind": "pi",
  "objective": "You are a long-lived parent development agent for this project. Wait for user instructions.",
  "metadata": { "run_kind": "parent_session", "long_lived": true },
  "timeout_ms": null
}
```

## List and read state

List tasks and filter for `run_kind: "parent_session"`, or use the TUI Parent Sessions view.

```sh
cuekit task list --format json
cuekit task status --task_id <task_id> --format json
cuekit task snapshot --task_id <task_id> --format json
```

`task status` includes the backend-provided `attach_command` when the task is attachable. `task snapshot` is the recommended pre-intervention read path because it includes recent events, latest handoffs, transcript tail, and derived run metadata.

## Attach

There is no dedicated `cuekit task attach` command in this MVP. Attach through one of these supported paths:

1. Open `cuekit tui`, press `p` for Parent Sessions, select the parent task, then press `a`.
2. Read `attach_command.argv` from `cuekit task status --task_id <task_id> --format json` and run that command manually.

Attach compatibility is backend-aware. cuekit spawns and addresses panes through the configured `MultiplexerBackend`, and the persisted task handle records whether tmux or zellij owns the task. Do not assume tmux-specific session names for zellij-owned tasks.

## Steer

Parent sessions are normal steerable tasks, so regular steering uses the existing task target surface:

```sh
cuekit steer target \
  --kind task \
  --task_id <task_id> \
  --message "Inspect current task/team state and propose the next step."
```

MCP grouped steering uses the same task fields:

```json
{
  "kind": "task",
  "task_id": "<task_id>",
  "message": "Inspect current task/team state and propose the next step."
}
```

## Handoff

Use typed handoff steering for substantial context transfer into any steerable task, including parent sessions. The handoff event is recorded on the target task only after the input has been successfully injected.

Human CLI options use snake_case:

```sh
cuekit steer target \
  --kind task \
  --task_id <task_id> \
  --event_type handoff \
  --message_file HANDOFF.md
```

MCP callers pass the same field names:

```json
{
  "kind": "task",
  "task_id": "<task_id>",
  "event_type": "handoff",
  "message_file": "HANDOFF.md"
}
```

Write provenance and context in the handoff body itself:

```md
# HANDOFF

From: operator note
Related PR: https://github.com/example/repo/pull/123

## Current state
...

## Suggested next step
...
```

## TUI flow

In `cuekit tui`:

- `p` toggles between the normal Tasks view and Parent Sessions view.
- `n` in Parent Sessions view creates a parent session with `role: "parent"`, parent metadata, and `timeout_ms: null`, then attaches immediately when possible.
- `a` attaches to the selected parent session using the status-provided attach command.
- Returning from attach restores the Parent Sessions view.

## Stop and cleanup

A parent session is stopped like any other long-running task:

```sh
cuekit task cancel --task_id <task_id>
```

Use deletion/cleanup only after the task is terminal and you no longer need its transcript/events.
