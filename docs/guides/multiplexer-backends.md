# Multiplexer backend guide

cuekit can run pane-backed tasks on tmux, zellij, or experimental Herdr. The configured backend decides where **new** tasks are spawned, but each task records the backend that originally created it. This keeps attach/status safe when `.cuekit.yaml` is switched while tasks are still running.

## Configure the backend

Preferred structured config:

```yaml
multiplexer:
  backend: zellij # tmux, zellij, or herdr
  strict: true    # fail instead of falling back when the backend is unavailable
```

Legacy aliases remain accepted during the compatibility window:

```yaml
multiplexer: zellij
multiplexer_strict: true
```

Long-lived cuekit processes (TUI, MCP servers, already-running adapter processes) construct a backend instance at startup. Restart or reload them after changing `.cuekit.yaml` when validating backend behaviour.

## Backend-qualified task handles

The task row's `native_task_ref` is the durable owner handle:

| Backend | Persisted `native_task_ref` | Display attach command |
|---|---|---|
| tmux | `tmux:%1` | `tmux attach-session -t cuekit-task-<task_id>` |
| zellij | `zellij:ct-<task_id>/pane` | `zellij attach ct-<task_id>` |
| zellij team member | `zellij:ctm-<team_id_suffix>/terminal_N` | `zellij attach ctm-<team_id_suffix>` |
| herdr | `herdr:<session>/<workspace_id>/<tab_id>/<pane_id>` | `herdr --session <session>` |
| legacy tmux rows | `%1` | treated as tmux |

Status views preserve legacy display fields by stripping the backend prefix:

- `native_task_id`
- `metadata.tmux_pane_id`

Use `metadata.pane_backend_kind` for the spawning backend and `metadata.pane_backend_mismatch: true` when the current process is configured for a different backend.

## What works during backend mismatch

When a task was created by one backend and the current process is using another:

Safe:

- `status` remains non-terminal unless the owning backend is actually checked.
- `attach_command` is still returned for known backends.
- TUI attach uses `attach_command.argv`, so attach remains available.

Not performed through the wrong backend:

- steering
- cancellation
- cleanup
- live liveness/capture operations

Those operations require either switching `.cuekit.yaml` back to the owning backend and reloading the process, or manually attaching with the printed command and handling the pane yourself.

## Herdr backend (experimental)

When `multiplexer.backend: herdr` is active, cuekit maps tasks onto Herdr's own hierarchy:

```text
Herdr session   = cuekit project/runtime namespace
Herdr workspace = cuekit solo task or cuekit team
Herdr tab       = default tab initially
Herdr pane      = cuekit task terminal
```

Solo tasks create one cuekit-owned workspace and run in the root pane. Team tasks share one cuekit-owned workspace with one pane per member; role-oriented tabs are deferred. The persisted `native_task_ref` stores the full Herdr coordinate because Herdr pane ids can compact when panes close. Before liveness, steering, capture, or kill, cuekit validates that the pane still belongs to the expected workspace and tab.

Attach opens the Herdr session, not a single pane:

```bash
herdr --session <session>
```

Herdr's `agent_status` is display-only for cuekit. `task_events` remain canonical for task/team result reporting.

## Zellij team dashboards

When `multiplexer.backend: zellij` is active, task teams use a shared zellij dashboard session instead of one session per member:

```text
ctm-<team_id_suffix>
```

For example, team `tm_abcd1234` uses zellij session `ctm-abcd1234`. Each member task records a pane handle such as `zellij:ctm-abcd1234/terminal_0`.

TUI attach behaviour:

- `A` on a team row attaches to the whole dashboard session.
- `Enter` on a team row focuses the member list.
- `a` on a selected member focuses that member's pane first, then attaches to the same dashboard session.

The zellij dashboard requires zellij `>= 0.44.2` because cuekit relies on pane ids returned by `zellij action new-pane` and pane-targeted actions (`write`, `dump-screen`, `rename-pane`, `close-pane`). Solo zellij tasks still use compact `ct-<task_id>` session names.

The TUI keeps list navigation responsive by using persisted list rows for high-frequency refreshes and refreshing exact liveness/transcript data for the selected detail. Zellij pane queries can be slower than tmux, so a small detail-panel lag and the `Loading detail…` spinner are expected when browsing zellij tasks or team members.

## Manual smoke: tmux task, then zellij config

1. Configure tmux:

   ```yaml
   multiplexer:
     backend: tmux
     strict: false
   ```

2. Submit an interactive task that stays alive:

   ```bash
   bun packages/cli/src/bin.ts task submit \
     --agent_kind pi \
     --cwd "$PWD" \
     --timeout_ms 600000 \
     --adapter_options '{"mode":"interactive"}' \
     --objective 'tmux smoke: stay running and wait for parent steering' \
     --format json
   ```

3. Confirm status contains `pane_backend_kind: "tmux"`, `native_task_ref` in the DB is `tmux:%...`, and `attach_command.argv` starts with `tmux attach-session`.

4. Switch config to zellij and reload any long-lived TUI/MCP processes.

5. Poll the same task:

   ```bash
   bun packages/cli/src/bin.ts task status --task_id <task_id> --format json
   ```

   Expected:

   - `status: "running"`
   - `metadata.pane_backend_kind: "tmux"`
   - `metadata.pane_backend_mismatch: true`
   - `attach_command.argv: ["tmux", "attach-session", "-t", "cuekit-task-<task_id>"]`

6. Attach from TUI or directly with the printed command.

## Manual smoke: zellij task, then tmux config

1. Configure zellij:

   ```yaml
   multiplexer:
     backend: zellij
     strict: true
   ```

2. Submit an interactive task that stays alive.

3. Confirm status contains `pane_backend_kind: "zellij"`, `native_task_ref` is `zellij:ct-<task_id>/pane`, and `attach_command.argv` is `zellij attach ct-<task_id>`.

4. Switch config to tmux and reload any long-lived TUI/MCP processes.

5. Poll the same task. Expected:

   - `status: "running"`
   - `metadata.pane_backend_kind: "zellij"`
   - `metadata.pane_backend_mismatch: true`
   - `attach_command.argv: ["zellij", "attach", "ct-<task_id>"]`

6. Attach from TUI or directly with the printed command.

## Cleanup tips

Cancel through the owning backend when possible:

```bash
bun packages/cli/src/bin.ts task cancel --task_ids <task_id> --format json
```

If the task is already terminal but the zellij session remains in `EXITED` state, remove it directly:

```bash
zellij delete-session ct-<task_id>
```

For zellij teams, `cuekit team cleanup` removes terminal member tasks. When cleanup deletes the last member task, cuekit also kills and deletes the shared dashboard session:

```bash
bun packages/cli/src/bin.ts team cleanup --team_id <team_id> --format json
bun packages/cli/src/bin.ts team delete --team_id <team_id> --format json
```

If a stale zellij team dashboard remains after manual interruption, remove both the running session and any tombstone:

```bash
zellij kill-session ctm-<team_id_suffix> 2>/dev/null || true
zellij delete-session ctm-<team_id_suffix> 2>/dev/null || true
```

If a tmux smoke task is left running:

```bash
tmux kill-session -t cuekit-task-<task_id>
```
