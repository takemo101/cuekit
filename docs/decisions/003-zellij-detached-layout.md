# 003: zellij detached task execution and attach semantics (2026-05-10)

## Problem

cuekit originally treated zellij like tmux: create a detached session and then send an `action new-pane` command into it. On zellij 0.43.x this is unreliable for fully detached sessions. The CLI may exit successfully while no worker pane is created, because zellij tries to place the pane relative to a connected client's active tab.

Related upstream context:

- zellij issue: `zellij --session <name> action new-pane` can silently fail when no client is attached.
- zellij fix direction: fall back to the first tab when no users are connected (not available in the tested 0.43.1 environment).

## Decision

For zellij Phase 3, cuekit starts each task as the **initial pane in a generated KDL layout**:

```text
zellij attach --create-background <session> options --default-cwd <cwd> --default-layout <layout.kdl>
```

The per-task session name is shortened to `ct-<task_id>` to avoid Unix socket path length limits on macOS.

zellij 0.43 does not return a stable pane id for layout-created panes, so cuekit records a synthetic handle: `<session>/pane`.

## Launch script strategy

Long prompts and shell wrappers are not embedded directly in KDL. cuekit writes a temporary `launch.sh` and points the layout pane at it. This avoids KDL escaping issues and very long inline strings.

Child reporting secrets (`CUEKIT_CHILD_TOKEN`, etc.) are not written into the KDL layout or process argv. They are written to a temporary `0600` `env.sh` next to the launch script and sourced by `launch.sh`. The temporary directory is removed by a shell trap on normal exit/signals.

Residual risk: while the task is running, the same local user may be able to inspect temp files or child process environments depending on platform permissions. This is acceptable for the local single-user v0 threat model, but the token must not be written into durable task artifacts or docs.

## Transcript vs attach tradeoff

zellij has no tmux `pipe-pane` equivalent. For non-interactive/batch tasks, cuekit wraps the launch in `script(1)` so stdout/stderr are captured while the child still sees a TTY.

Interactive attachable tasks **must not** use the `script` wrapper. `script(1)` creates an inner pty sized at zellij's headless default and does not reliably propagate resize events after a human attaches. That made AI CLIs render in a narrow 80-column box inside a full-width zellij pane.

Therefore:

- batch / non-attachable: use `script` transcript wrapper
- interactive / attachable: use zellij native pane TTY; transcript capture may be sparse and live attach/capture is the primary UX

## TUI attach semantics

The TUI must consume `TaskStatusView.attach_command.argv` instead of reconstructing tmux commands from `tmux_session_name`. For zellij this is:

```text
zellij attach ct-<task_id>
```

For tmux, the TUI still expands plain tmux attach argv into the historical mouse-enabled sequence:

```text
tmux set-option -t <session> mouse on ; attach-session -t <session>
```

## Lifecycle semantics

zellij can leave exited sessions in `list-sessions` as `(EXITED - attach to resurrect)`. cuekit treats those as not alive and `killPane` falls back to `delete-session` when `kill-session` cannot remove an exited session.

When a pane disappears before the exit-code sentinel is visible, cuekit waits briefly and defers failure if there was a recent child event. During this deferral, attach/steering are suppressed because the pane is already gone even though the task row remains temporarily `running`.

Task rows store the backend kind in `native_task_ref` (`tmux:%1`, `zellij:ct-<task_id>/pane`). If a long-lived process was started with one backend and the project config later switches to another, status polling must not infer pane death through the wrong backend. In that mismatch case, cuekit leaves the task non-terminal and suppresses steering/liveness actions from the stale adapter view rather than fabricating a failed result. Attach remains available for known backends because the command can be reconstructed from the stored backend kind and deterministic session name (`tmux attach-session -t cuekit-task-<task_id>` or `zellij attach ct-<task_id>`).

## Validation notes

Verified manually/dogfooded on zellij 0.43.1:

- zellij layout-created command runs in a detached session
- interactive pi / claude-code / opencode tasks attach from cuekit TUI
- interactive tasks render full width after removing the `script` wrapper
- shared DB pi batch task can report `completed` via `task_events`
- zellij integration test runs under `CUEKIT_ZELLIJ_INTEG=1`

## Known limitations

- `script(1)` argv differs between BSD/macOS and util-linux. The backend chooses macOS syntax on `process.platform === "darwin"` and util-linux-style `-c` elsewhere, but Linux zellij transcript behavior still deserves real integration coverage.
- zellij batch transcript output contains terminal control sequences by design because it captures TTY output.
- Phase 4 team dashboard / multi-pane zellij sessions are not implemented.
