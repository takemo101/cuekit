# jcode Adapter Guide

cuekit's `jcode` adapter runs `jcode repl` inside the existing tmux pane backend. This gives the same high-level operator workflow as the other pane adapters: submit a task, attach to the live tmux pane, steer the task, and inspect the captured transcript.

The adapter intentionally uses REPL mode rather than `jcode run`. `jcode run` is single-shot and exits after one message; `jcode repl` can stay alive long enough for cuekit `steer_task` / CLI steering to send follow-up input.

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

## Notes

- The `jcode` adapter supports model selection through `--model`.
- The adapter does not currently implement cuekit permission-bypass semantics. Do not assume `adapter_options.dangerously_skip_permissions` affects jcode.
- Provider profiles are planned separately via `adapter_options.provider_profile`.
