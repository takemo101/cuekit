# Project Config (`.cuekit.yaml`)

`.cuekit.yaml` gives a repository a stable identity and safe defaults for `submit_task`, the TUI, Task Teams, and Team Strategies. cuekit reads it from the nearest parent directory of the working `cwd`.

## Initialize

```sh
cd /path/to/your/repo
cuekit init
```

This writes a safe `.cuekit.yaml` with prompt-safe adapter defaults and adds `.cuekit/tasks/` to `.gitignore`.

Available flags:

```sh
cuekit init --dry-run        # preview files without writing
cuekit init --force          # overwrite existing .cuekit.yaml
cuekit init --no-gitignore   # do not touch .gitignore
cuekit init --unsafe-bypass  # generate `permissions: bypass` (trusted repos only)
```

::: tip
For a fuller commented starting point, copy [`.cuekit.example.yaml`](https://github.com/takemo101/cuekit/blob/main/.cuekit.example.yaml) instead:

```sh
cp .cuekit.example.yaml .cuekit.yaml
```
:::

::: warning
`--unsafe-bypass` writes `adapters.<agent>.permissions: bypass`. Only use it in repositories where you trust every contributor with full shell access from the agent. Project-derived role/agent defaults will *still* force prompt-safe adapter options unless a caller explicitly sets `adapter_options`.
:::

## Discovery and project identity

cuekit searches upward from `cwd` for the nearest `.cuekit.yaml`. When found:

- Its directory is the **config root**.
- `project_uid` is derived from `config_root + project.id` — so copied repos with identical config still get distinct ids.
- Without `.cuekit.yaml`, cuekit falls back to the Git root, then to `cwd`.

`project.id` is a stable human-readable label, **not** an isolation key. The combination with `config_root` is the actual isolation key.

## Minimal example

```yaml
project:
  id: cuekit
  name: Cuekit

tui:
  scope: project    # or: path

submit:
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 1800000
  priority: normal

teams:
  roles:
    coordinator: planner
    worker: worker
    reviewer: reviewer
  wait:
    timeout_ms: 300000
    poll_interval_ms: 2000
  cleanup: keep-team

adapters:
  claude-code:
    permissions: prompt  # safe default
```

## Submit defaults

`submit.*` fills omitted fields for `submit_task`. Precedence (high → low):

1. Explicit request field
2. Selected Agent Profile field (for `agent_kind` / `model`)
3. `.cuekit.yaml` `submit.*` default

`role` is resolved first; the chosen Agent Profile can still supply `agent`/`model`. To opt out of a configured project timeout for one task, pass `timeout_ms: null` at submit time.

## Multiplexer

cuekit defaults to **tmux**. Opt into **zellij** ≥ 0.43 or **[herdr](https://herdr.dev)** ≥ 0.5 by setting `multiplexer.backend`:

```yaml
multiplexer:
  backend: zellij   # or "herdr", default is "tmux"
  strict: false     # true → hard-fail if the backend is missing
```

Per-task multiplexer dispatch: a task spawned under one backend stays attachable through that backend even if `.cuekit.yaml` is later switched. The owning backend is recorded at spawn time.

## Task Teams defaults

```yaml
teams:
  roles:
    coordinator: planner
    worker: worker
    reviewer: reviewer
    finisher: pr-finisher
  wait:
    timeout_ms: 300000
    poll_interval_ms: 2000
  cleanup: keep-team
```

- `teams.roles.<position>` is applied to a `submit_team_tasks` item only when it has a `position` and no explicit `role`.
- `teams.wait.*` supplies defaults for `wait({ kind: "team" })` when the request omits them.
- `teams.cleanup: delete-empty-team` is **reserved** — use `keep-team` today.

## Team Strategies

Define project-local missions under `strategies`. cuekit renders the strategy into the coordinator's prompt; it does *not* execute a workflow.

```yaml
strategies:
  docs-polish:
    description: "Light README/docs improvements"
    intent: "Make minimal docs-only changes and verify meaning is preserved."
    recommended_team:
      coordinator: { position: coordinator, role: planner, agent: pi }
      worker:      { position: worker,      role: worker,  agent: pi }
      reviewer:    { position: reviewer,    role: reviewer, agent: claude-code, model: sonnet }
    guardrails:
      - "Keep changes docs-only."
      - "Do not commit/push/PR unless explicitly requested."
    success_criteria:
      - "Diff is limited to README/docs."
      - "Meaning is preserved."
    checks:
      - "git diff --check"
      - "bun run check"
    autonomy:
      allow_additional_workers: true
      require_reviewer: true
```

Full field reference and design rationale → [Team Strategies](/guides/team-strategies).

## TUI scope

```yaml
tui:
  scope: project   # default — show tasks/teams for this project_uid
  # scope: path    # ignore project identity; scope to current path/Git root
```

`tui.scope: all` is intentionally rejected by the config schema. Use `cuekit tui --all` for an explicit one-off global view.

## Adapter permissions

```yaml
adapters:
  claude-code:
    permissions: prompt   # safe default
  opencode:
    permissions: prompt
  gemini:
    permissions: prompt   # only toggles -y; --skip-trust is always applied
```

Safety rules:

- `permissions: prompt` forces safe permissions unless the caller explicitly passes `adapter_options`.
- `permissions: bypass` is allowed but should be reserved for trusted repos.
- Project-derived `submit.role` / `submit.agent` / `teams.roles.<position>` selections always force `adapter_options.dangerously_skip_permissions = false` when the caller does not explicitly supply `adapter_options`.

## Hooks

Fire-and-forget shell commands on lifecycle events. Hooks never block the workflow and never affect task status.

```yaml
hooks:
  on_task_complete:
    command: "osascript -e 'display notification \"Done: $CUEKIT_OBJECTIVE\" with title \"cuekit\"'"
    timeout: 10
  on_task_fail:
    command: "osascript -e 'display notification \"Failed: $CUEKIT_OBJECTIVE\" with title \"cuekit\"'"
    timeout: 10
```

Supported events: `on_task_start`, `on_task_complete`, `on_task_fail`, `on_task_cancel`, `on_task_timeout`, `on_task_block`, `on_team_start`, `on_team_complete`.

Each event accepts a single hook definition or an array (run concurrently). Hook commands are executed via `/bin/sh -c` and receive metadata via environment variables:

| Variable | Description |
|---|---|
| `CUEKIT_EVENT` | Event name |
| `CUEKIT_TASK_ID` | Task id |
| `CUEKIT_STATUS` | Terminal status |
| `CUEKIT_AGENT_KIND` | Adapter (e.g. `claude-code`) |
| `CUEKIT_AGENT_MODEL` | Model id |
| `CUEKIT_OBJECTIVE` | Truncated to 500 chars |
| `CUEKIT_TEAM_ID` | Team id (if applicable) |
| `CUEKIT_POSITION` | Team position |
| `CUEKIT_STRATEGY` | Team strategy name |
| `CUEKIT_SESSION_ID` | Session id |
| `CUEKIT_PROJECT_ID` | Project id from `.cuekit.yaml` (if set) |
| `CUEKIT_DURATION_MS` | Duration in ms |

### Slack webhook example

```yaml
hooks:
  on_task_complete:
    command: 'curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"Task $CUEKIT_TASK_ID completed\"}" https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
    timeout: 10
```

## Schema notes

Top-level keys are strict — unknown keys are rejected. Key constraints:

- `project.id`: `[A-Za-z0-9._-]+`
- `tui.scope`: `project` | `path`
- `submit.priority`: `low` | `normal` | `high`
- `submit.timeout_ms`: positive integer (or omit; `null` is for runtime calls only)
- `teams.cleanup`: `keep-team` (`delete-empty-team` is reserved)
- `adapters.<agent>.permissions`: `prompt` | `bypass`
- `strategies.<name>.recommended_team.<slot>.position`: `coordinator` | `worker` | `reviewer` | `finisher` | `observer`

Full schema list (kept in sync with the implementation): [`docs/guides/project-config.md`](https://github.com/takemo101/cuekit/blob/main/docs/guides/project-config.md).

## Related

- [Quickstart](/quickstart) — uses `cuekit init` in step 2.
- [Team Strategies](/guides/team-strategies) — full strategy field reference.
- [Agent Profiles](/guides/agent-profiles) — `role` resolution and authoring.
- [MCP Tools](/api/mcp-tools) — `start_team_strategy`, `submit_task`, `list({kind:"strategies"})`.
