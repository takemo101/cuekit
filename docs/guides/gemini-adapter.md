# gemini Adapter Guide

cuekit's `gemini` adapter runs the Google Gemini CLI inside the existing tmux pane backend. It supports both interactive (default) and batch run modes from day one because the CLI exposes them first-class with the same flag set.

The adapter always passes `--skip-trust` so unattended panes never stall on Gemini's per-directory trust gate (which, unlike Claude Code, is not auto-skipped in non-TTY mode). It also defaults `-y` (yolo) on, removable only via explicit `adapter_options.dangerously_skip_permissions: false`. The trust flag is independent of the permission flag and stays in place even when `-y` is opted out.

For the design rationale (trust handling, run modes, capability projection), see [`../designs/cuekit-gemini-adapter-design.md`](../designs/cuekit-gemini-adapter-design.md).

## Prerequisites

Automated tests do not require real gemini. The smoke test below does.

```sh
command -v gemini
gemini --version
command -v tmux
```

If you have never used `gemini` interactively in this directory, the cuekit adapter will still pass `--skip-trust` so the child does not block on the trust dialog. You can also pre-trust the directory once with `gemini` outside cuekit if you prefer the persistent state in `~/.gemini/trustedFolders.json`.

The adapter assumes Gemini auth is already set up (interactive `gemini auth` login or `GEMINI_API_KEY`-style env var). cuekit does not write or refresh credentials.

## Submit and attach smoke test

From a real repository where it is safe for a child agent to inspect files:

```sh
cuekit task submit \
  --agent_kind gemini \
  --model gemini-2.5-flash \
  --objective "Say 'hello' and wait for a follow-up instruction."
```

Inspect status:

```sh
cuekit task status --task_id <task_id>
```

The status output should include an attach hint like:

```sh
tmux attach-session -t cuekit-task-<task_id>
```

Attach to the pane:

```sh
tmux attach-session -t cuekit-task-<task_id>
```

Expected observations:

- `gemini` starts in the pane and presents its REPL prompt.
- The rendered cuekit task prompt is submitted automatically.
- The child response streams in the pane.
- Detaching with `Ctrl-b d` leaves the task running.

You can confirm `--skip-trust` and `-y` are present in the launch command by capturing the pane:

```sh
tmux capture-pane -t cuekit-task-<task_id> -p | head -1
```

## Steering smoke test

After the first response starts or completes, steer the task from another terminal:

```sh
cuekit task steer \
  --task_id <task_id> \
  --message "Now summarize your previous answer in exactly seven words."
```

Expected observations in the attached pane:

- The follow-up message appears in the REPL input.
- gemini responds to the follow-up instead of exiting after the initial prompt.

This verifies the adapter's `tmux send-keys` steering channel reaches Gemini's REPL after the initial prompt.

## Batch mode smoke test

Use batch mode when the task should answer once and exit:

```sh
cuekit task submit \
  --agent_kind gemini \
  --model gemini-2.5-flash \
  --adapter_options '{"mode":"batch"}' \
  --objective "Say hello, then report completed and exit."
```

Expected observations:

- The launched command shape is `gemini --skip-trust -y -m '...' -p '<prompt>'` rather than the interactive positional form.
- `cuekit task status --task_id <task_id>` reports `metadata.adapter_mode: "batch"` and `supports_steering: false`.
- A steer attempt is rejected with `steering_unsupported`:

  ```sh
  cuekit task steer --task_id <task_id> --message "ignored"
  # → error: steering_unsupported
  ```

- The pane/transcript remain useful for output inspection until cleanup.

## Auto-cleanup after terminal report

By default the cuekit reporting contract is "reporting does not close your pane or process; finish normally after reporting." Gemini's REPL doesn't have a clean self-exit path after `report_task_event`, so an interactive task will idle at the prompt until you delete it.

When you know the parent will not need the pane after the child reports, opt into automatic cleanup at submit time:

```sh
cuekit task submit \
  --agent_kind gemini \
  --model gemini-2.5-flash \
  --adapter_options '{"cleanup_on_terminal_report": true}' \
  --objective "..."
```

With this option set, the moment the child sends a terminal `task_event` (`completed` / `failed` / `blocked`), cuekit kills the tmux session synchronously. The terminal status itself is committed to SQLite first, so a cleanup failure (e.g. session already gone) is logged but does not roll back the report.

This option is adapter-agnostic; it applies to any pane adapter, not just Gemini. It is most useful for Gemini specifically because the REPL is the most likely runtime to idle indefinitely after reporting.

## Permission opt-out

To disable the default `-y` (yolo) and let Gemini prompt for tool approvals — for trusted local sessions where a human is ready to attach — pass:

```sh
cuekit task submit \
  --agent_kind gemini \
  --adapter_options '{"dangerously_skip_permissions": false}' \
  --objective "..."
```

`--skip-trust` stays in place even with this opt-out. There is intentionally no `adapter_options` toggle for the trust flag — cuekit's "unattended pane must make progress" invariant requires it always.

## Transcript and task result checks

cuekit captures the pane transcript at:

```sh
<worktree>/.cuekit/tasks/<task_id>/transcript.txt
```

Inspect after a run:

```sh
sed -n '1,160p' .cuekit/tasks/<task_id>/transcript.txt
```

Child agents should report terminal status through cuekit reporting when available:

```sh
cuekit tool report --type completed --message "Completed gemini smoke test."
```

If gemini does not have cuekit MCP/tool access in the child environment, use the transcript and task status as the fallback observation path.

## Cleanup

Cancel or delete the task when done:

```sh
cuekit task cancel --task_ids <task_id>
cuekit task delete --task_ids <task_id>
```

The transcript file remains on disk after cleanup so postmortem inspection is still possible.

## Notes

- The `gemini` adapter advertises a curated list of API model IDs (`gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`). The Gemini CLI does not validate model names locally — the API does — so cuekit passes `--model` through verbatim. Override the curated list at construction time with `availableModels` if you need to surface a different set in `list({ kind: "adapters" })`.
- Omitting `--model` leaves model selection to Gemini's own logic (and to the Gemma Model Router if the user has it enabled in `~/.gemini/settings.json`). The adapter does not interact with the router.
- `--approval-mode` (4-value: `default` / `auto_edit` / `yolo` / `plan`) is not exposed as an `adapter_options` toggle in v0. The adapter maps the binary `dangerously_skip_permissions` to `-y` only. Reconsider if a profile (e.g. a read-only `reviewer` role) needs `plan` mode.
