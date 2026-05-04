# jcode Adapter Guide

cuekit's `jcode` adapter runs `jcode repl` inside the existing tmux pane backend by default. This gives the same high-level operator workflow as the other pane adapters: submit a task, attach to the live tmux pane, steer the task, and inspect the captured transcript.

The default interactive mode intentionally uses REPL mode rather than `jcode run`. `jcode run` is single-shot and exits after one message; `jcode repl` can stay alive long enough for cuekit `steer_task` / CLI steering to send follow-up input.

For short unattended jobs, callers can opt into non-interactive batch mode with `adapter_options.mode: "batch"`. Batch mode launches `jcode run --no-update <prompt>` in the pane. It is attachable for streaming output/transcript capture, but it is not steerable.

## Prerequisites

Automated tests do not require real jcode. The smoke test below does.

Verify local tools first:

```sh
command -v jcode
jcode auth status
jcode repl --help
command -v tmux
```

If `jcode auth status` reports missing credentials, authenticate with jcode before running the smoke test. If `tmux` is unavailable, cuekit can still run fake-backed tests, but live attach/steer verification is not possible.

## Submit and attach smoke test

Install or link the current checkout first:

```sh
just install
```

From a real repository where it is safe for a child agent to inspect files:

```sh
cuekit task submit \
  --agent_kind jcode \
  --objective "Say hello, describe this repository in one sentence, then wait for a follow-up instruction."
```

The command returns a `task_id`. Inspect status:

```sh
cuekit task status --task_id <task_id>
```

The status should include an attach hint like:

```sh
tmux attach-session -t cuekit-task-<task_id>
```

Attach to the pane:

```sh
tmux attach-session -t cuekit-task-<task_id>
```

Expected observations:

- `jcode repl` starts in the pane.
- The rendered cuekit task prompt is submitted automatically.
- The child response streams in the pane.
- Detaching with `Ctrl-b d` leaves the task running.

## Steering smoke test

After the first response starts or completes, steer the task from another terminal:

```sh
cuekit task steer \
  --task_id <task_id> \
  --message "Now summarize the previous answer in exactly seven words."
```

Expected observations in the attached pane:

- The follow-up message appears in the REPL input stream.
- jcode responds to the follow-up instead of exiting after the initial prompt.

This verifies the jcode adapter's FIFO feeder is still reading from the pane tty after the initial prompt.

## Batch mode smoke test

Use batch mode when the task should answer once and exit:

```sh
cuekit task submit \
  --agent_kind jcode \
  --adapter_options '{"mode":"batch"}' \
  --objective "Say hello, then report completed and exit."
```

Expected observations:

- The launched command is `jcode run --no-update ...` rather than `jcode repl`.
- `cuekit task status --task_id <task_id>` reports `metadata.adapter_mode: batch`.
- `supports_steering` is false for the batch task.
- The pane/transcript remain useful for output inspection until cleanup.

## Transcript and task result checks

cuekit captures the pane transcript at:

```sh
<worktree>/.cuekit/tasks/<task_id>/transcript.txt
```

Check it after the run:

```sh
sed -n '1,160p' .cuekit/tasks/<task_id>/transcript.txt
```

Child agents should report terminal status through cuekit reporting when available:

```sh
cuekit tool report --type completed --message "Completed jcode smoke test."
```

If jcode does not have cuekit MCP/tool access in the child environment, use the transcript and task status as the fallback observation path.

## Cleanup

Cancel or delete the task when done:

```sh
cuekit task cancel --task_ids <task_id>
cuekit task delete --task_ids <task_id>
```

If the task already reported a terminal status, delete may be enough. If a tmux session is still alive, cancel first.

## jcode REPL session lifecycle note

jcode v0.11.x tracks active local sessions with PID marker files under:

```sh
~/.jcode/active_pids/<session_id>
```

On a later plain `jcode` TUI launch, jcode scans those marker files. If a marker points at a PID that is no longer running, jcode treats the session as an unexpected shutdown and may synthesize a reboot snapshot, producing output like:

```text
Detected N recent jcode session crash(es) from an unexpected shutdown. Restoring them now...
```

This matters for the cuekit adapter because `jcode repl` marks its session active, but in jcode v0.11.x the REPL's normal `quit` / `exit` / EOF path does not mark the session closed. A cuekit-managed tmux pane can therefore leave a stale `active_pids` marker even when the REPL exited normally.

The adapter works around this by launching `jcode repl` as a child process, recording its PID, waiting for it to exit, and then removing only the `~/.jcode/active_pids/*` marker whose contents match that child PID. This prevents cuekit-managed REPL sessions from being restored as ghost jcode windows on the next plain `jcode` launch.

If stale markers already exist from older adapter runs, clear any generated reboot snapshot with:

```sh
jcode restart clear
```

If necessary, inspect `~/.jcode/active_pids` and remove markers for PIDs that are no longer running. Do not remove markers for live jcode sessions.

## Notes

- The `jcode` adapter supports model selection through `--model`.
- To select a named jcode provider profile, submit with `adapter_options.provider_profile`. cuekit translates a non-empty string value to `--provider-profile <name>` in both interactive and batch modes.
- The adapter does not currently implement cuekit permission-bypass semantics. Do not assume `adapter_options.dangerously_skip_permissions` affects jcode.
