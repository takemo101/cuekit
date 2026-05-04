# Project Config (`.cuekit.yaml`)

cuekit can read a project-local `.cuekit.yaml` to give a repository a stable identity and safe defaults for the TUI, `submit_task`, and Task Teams.

Initialize a project with:

```sh
cuekit init
```

This creates a safe `.cuekit.yaml` and creates or updates `.gitignore` with `.cuekit/tasks/` for local task artifacts. You can also copy `.cuekit.example.yaml` manually when you want a fuller commented starting point:

```sh
cp .cuekit.example.yaml .cuekit.yaml
```

## Discovery and identity

cuekit searches upward from the current `cwd` for the nearest `.cuekit.yaml`.

- If found, its directory is the `config_root` and cuekit derives a `project_uid` from `config_root + project.id`.
- If `project.id` is omitted, cuekit derives a safe path-based id.
- If no config exists, cuekit falls back to the Git root; outside Git it falls back to `cwd`.

`project.id` is not used alone for isolation. Copied repos with the same `.cuekit.yaml` get different `project_uid` values because their config roots differ.

## Example

```yaml
project:
  id: cuekit
  name: Cuekit

tui:
  # project = use .cuekit.yaml project identity for the TUI default scope.
  scope: project

submit:
  # Defaults for submit_task. Explicit request fields always win.
  # If role is set, the selected Agent Profile can still provide agent/model.
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 1800000
  priority: normal

teams:
  roles:
    # Default Agent Profile role per team position.
    coordinator: planner
    worker: worker
    reviewer: reviewer
  wait:
    # Defaults for wait_team unless request fields override them.
    timeout_ms: 300000
    poll_interval_ms: 2000
  # Planned/inactive until cuekit has a delete_team operation.
  cleanup: keep-team

adapters:
  claude-code:
    # prompt keeps generated config safe. Use bypass only for trusted repos.
    permissions: prompt
```

## `cuekit init`

`cuekit init` is a human CLI command for creating project-local cuekit files. It is not an MCP tool.

Default behavior:

- creates `.cuekit.yaml` in the current directory
- creates or updates `.gitignore`
- adds only `.cuekit/tasks/` to `.gitignore`
- refuses to overwrite an existing `.cuekit.yaml`

Generated `.cuekit.yaml` is a commented starting point. By default it includes project identity, `tui.scope: project`, `submit_task` defaults, Task Teams role/wait/cleanup defaults, and prompt-safe adapter permission defaults. It does not generate `teams.cleanup: delete-empty-team`.

Options:

```sh
cuekit init --dry-run        # preview files without writing
cuekit init --force          # overwrite existing .cuekit.yaml
cuekit init --no-gitignore   # do not create or update .gitignore
cuekit init --unsafe-bypass  # generate adapter permissions: bypass for trusted repos
```

`--unsafe-bypass` is an explicit opt-in for trusted repositories. It writes `permissions: bypass` for generated adapter defaults and prints a warning.

The `.gitignore` update ignores task artifacts only:

```gitignore
# cuekit local task artifacts
.cuekit/tasks/
```

Do not ignore `.cuekit/` as a whole if you want to commit project Agent Profiles such as `.cuekit/agents/reviewer.md`.

## TUI scope

`cuekit tui` is a human-only command and is not an MCP tool.

By default:

- With `.cuekit.yaml`, it shows the current config project.
- It includes new rows with the same `project_uid` and legacy rows whose `project_root` matches the config root.
- Without config, it scopes to the current path/Git root.

Overrides:

```sh
cuekit tui --path  # ignore .cuekit.yaml identity; use path/Git-root scope
cuekit tui --all   # show all tasks globally for this invocation
```

Project config supports only `tui.scope: project` or `tui.scope: path`. `all` is intentionally not allowed in project-local config; global view requires the explicit CLI flag.

## Submit defaults and precedence

`submit` fills omitted fields for `submit_task`.

Precedence:

1. Explicit request field
2. Selected Agent Profile field (for `agent_kind` / `model`)
3. `.cuekit.yaml` submit default
4. validation error if `agent_kind` is still missing

Detailed order:

- `role = explicit role ?? submit.role`
- Resolve Agent Profile when role is present.
- `agent_kind = explicit agent_kind ?? profile.agent_kind ?? submit.agent`
- `model = explicit model ?? profile.model ?? submit.model`
- `timeout_ms = explicit timeout_ms ?? submit.timeout_ms`; explicit `timeout_ms: null` disables the project default for that task and stores no task timeout
- `priority = explicit priority ?? submit.priority`

## Task Teams defaults

`teams.roles.<position>` supplies a role for `submit_team_tasks` items when:

- the task has a `position`, and
- the task omits `role`.

Explicit per-task `role` always wins.

`teams.wait.timeout_ms` and `teams.wait.poll_interval_ms` supply defaults for `wait_team` when the request omits them. Explicit wait inputs win.

`teams.cleanup: delete-empty-team` is planned but inactive until cuekit has a `delete_team` operation. Use `keep-team` today.

## Safety rules

Project-local config can affect adapter permissions, so use bypass only in trusted repositories.

- `adapters.<agent>.permissions: prompt` forces safe permissions for that adapter unless the caller explicitly supplies `adapter_options`.
- `adapters.<agent>.permissions: bypass` is allowed for explicit opt-in cases such as `cuekit init --unsafe-bypass`.
- If `submit.role`, `submit.agent`, or `teams.roles.<position>` selects behavior from project config, cuekit forces `adapter_options.dangerously_skip_permissions = false` unless the caller explicitly supplies `adapter_options`.

This keeps project-derived executable behavior safe while still allowing intentional project-local adapter defaults or explicit one-off caller overrides.

## Adapter run modes

Built-in pane adapters default to `interactive` mode. Interactive tasks are attachable and steerable when the runtime supports it.

For a short one-shot task, callers can opt into non-interactive batch mode with explicit per-task adapter options:

```json
{
  "agent_kind": "claude-code",
  "objective": "Review the staged diff once and report findings.",
  "adapter_options": {
    "mode": "batch"
  }
}
```

Batch mode still runs in a tmux pane, so attach/transcript inspection remains useful. It is not steerable: task status reports `metadata.adapter_mode: "batch"` and `supports_steering: false`, and `steer_task` returns `steering_unsupported`.

Task Teams can mix modes per task. For example, keep a worker interactive but make a bounded reviewer batch-only:

```json
{
  "tasks": [
    { "position": "worker", "objective": "Implement the change." },
    {
      "position": "reviewer",
      "objective": "Review the final diff once and report issues.",
      "adapter_options": { "mode": "batch" }
    }
  ]
}
```

`adapter list` reports each adapter's default capabilities. `task status` reports the actual mode selected for that task.

## Schema reference

Top-level keys are strict: unknown top-level keys are rejected.

- `project.id`: optional `[A-Za-z0-9._-]+`
- `project.name`: optional display name
- `tui.scope`: `project` or `path`
- `submit.role`: optional Agent Profile id
- `submit.agent`: optional adapter kind (`claude-code`, `opencode`, `pi`, ...)
- `submit.model`: optional adapter model
- `submit.timeout_ms`: positive integer
- `submit.priority`: `low`, `normal`, or `high`
- `teams.roles`: optional role defaults for `coordinator`, `worker`, `reviewer`, `observer`
- `teams.wait.timeout_ms`: integer `>= 0`
- `teams.wait.poll_interval_ms`: positive integer
- `teams.cleanup`: currently `keep-team` only in practice; `delete-empty-team` is reserved/planned
- `adapters.<agent>.permissions`: `prompt` or `bypass`
