# cuekit Project Config Design

## Status

Proposed design. Not implemented yet.

## Context

cuekit stores durable state in the global SQLite database at `~/.cuekit/state.db`, while task artifacts live under each worktree's `.cuekit/tasks/` directory. This global DB makes cross-session tooling possible, but it means human views such as `cuekit tui` need an explicit scope to avoid showing unrelated project tasks.

The current TUI default scopes by `sessions.project_root`, derived from the current Git/worktree root. That is safe, but it is path-based only:

- separate Git worktrees are treated as separate projects;
- non-Git directories fall back to cwd;
- users cannot intentionally name or group cuekit projects;
- future defaults for submission/team behavior have no project-local config home.

`isuner` uses a project-local YAML file (`.isuner.yaml`) as the configuration anchor. cuekit should adopt the same style with `.cuekit.yaml`.

## Goals

- Add a project-local YAML config file as the primary project identity anchor.
- Keep YAML project scope safe by default: a copied `.cuekit.yaml` must not accidentally merge separate worktrees unless the user explicitly asks for grouping.
- Keep path/Git-root scoping as a fallback and as an explicit mode.
- Avoid `default_*` field names; section-local values are defaults for that section.
- Provide room for submit and Task Teams defaults without overloading Agent Profiles.
- Keep global DB storage unchanged.
- Keep TUI safe by default: no accidental cross-project/global task mixing.

## Non-goals

- Do not move SQLite state into the project directory.
- Do not automatically group all Git worktrees from the same common-dir.
- Do not replace Agent Profiles; config defaults only select or supplement existing mechanisms.
- Do not make TUI an MCP operation.

## Config file

Default filename:

```text
.cuekit.yaml
```

Search behavior:

1. Starting from cwd, walk upward looking for `.cuekit.yaml`.
2. If found, the containing directory is the cuekit config root.
3. If not found, fall back to the existing Git/project-root discovery.
4. If neither exists, fall back to cwd.

## Recommended shape

```yaml
project:
  id: cuekit
  name: cuekit

# Human cockpit behavior.
tui:
  scope: project # project | path; use CLI --all for global view

# Defaults applied by submit_task when the caller omits these fields.
submit:
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 300000
  priority: normal

# Defaults applied by Task Teams helpers.
teams:
  roles:
    coordinator: planner
    worker: worker
    reviewer: reviewer
    observer: scout
  cleanup: keep-team # keep-team | delete-empty-team
  wait:
    timeout_ms: 300000
    poll_interval_ms: 2000

# Human-friendly adapter defaults. These are translated to adapter_options.
adapters:
  claude-code:
    permissions: prompt # project config may only make permissions safer
  opencode:
    permissions: prompt
```

## Field semantics

### `project`

```yaml
project:
  id: cuekit
  name: cuekit
```

- `project.id` is a human-stable project label, not globally unique by itself.
- `project.name` is display-only.
- The safe project identity is the pair `(config_root, project.id)` or an equivalent generated per-config-root UID. This prevents copied `.cuekit.yaml` files in separate worktrees or unrelated clones from being merged accidentally.
- If `.cuekit.yaml` exists but `project.id` is omitted, cuekit can derive a path-based identity from the config root for compatibility.
- `project.id` should be restricted to a simple stable token, for example `[A-Za-z0-9._-]+`.
- Cross-worktree grouping must be explicit later, for example via a separate `project.group` field or a `cuekit tui --group` scope. It should not be the default meaning of `project.id`.

### `tui`

```yaml
tui:
  scope: project
```

Allowed project-config values:

- `project`: show tasks for the `.cuekit.yaml` safe project identity when available; otherwise path/Git-root fallback.
- `path`: show tasks for the current worktree/path root only.

`all` is intentionally not allowed from project-local `.cuekit.yaml`, because a cloned repository must not silently widen `cuekit tui` to the global DB. Global display requires an explicit CLI flag or a future trusted user-level config.

CLI overrides should win over config:

```bash
cuekit tui          # use tui.scope, defaulting to project
cuekit tui --path   # force path scope
cuekit tui --all    # force global scope for this invocation
```

### `submit`

```yaml
submit:
  role: worker
  agent: claude-code
  model: sonnet
  timeout_ms: 300000
  priority: normal
```

These values are applied only when the caller omits the corresponding `submit_task` input.

Mapping:

- `submit.role` -> `role`
- `submit.agent` -> `agent_kind`
- `submit.model` -> `model`
- `submit.timeout_ms` -> `timeout_ms`
- `submit.priority` -> `priority`

Merge algorithm:

1. Determine role selector: `explicit role ?? config.submit.role`.
2. If a role selector is present, resolve the Agent Profile using the existing explicit/auto role behavior.
3. Enforce the same trust boundary as adapter permissions: a project-local `submit.role` may select role instructions and ordinary profile defaults, but a task whose role was selected by untrusted project config must run with safe permissions (`dangerously_skip_permissions: false`) unless permission bypass is explicitly requested by the caller or a future trusted user-level config. This applies even if the selected adapter's built-in default would otherwise bypass permissions. Unsafe adapter options from profiles selected only by project config should be ignored or rejected until a trust mechanism exists.
4. Determine `agent_kind`: `explicit agent_kind ?? selected_profile.agent_kind ?? config.submit.agent ?? invalid_input`.
5. Determine `model`: `explicit model ?? selected_profile.model ?? config.submit.model ?? undefined`.
6. Determine non-profile fields such as `timeout_ms` and `priority`: explicit submit input wins, then config defaults, then existing built-in behavior.

Important nuance: config defaults behave like omitted user input, not like explicit user input. Therefore `submit.agent` and `submit.model` do not override a selected Agent Profile; they only fill gaps when explicit input and profile values are absent.

### `teams`

```yaml
teams:
  roles:
    coordinator: planner
    worker: worker
    reviewer: reviewer
    observer: scout
  cleanup: keep-team
  wait:
    timeout_ms: 300000
    poll_interval_ms: 2000
```

`teams.roles` maps a team `position` to an Agent Profile `role` when a team task omits `role`.

Examples:

- `position: coordinator` + no `role` -> `role: planner`
- `position: reviewer` + no `role` -> `role: reviewer`

`teams.wait` provides defaults for `wait_team` when omitted.

`teams.cleanup` defines preferred cleanup behavior for future team cleanup flows:

- `keep-team`: delete terminal tasks but keep the team row;
- `delete-empty-team`: after cleanup, delete the team row when no tasks remain. This requires a future `delete_team` capability; until then it is a planned value, not active behavior.

### `adapters`

```yaml
adapters:
  claude-code:
    permissions: prompt
  opencode:
    permissions: prompt
```

Human-facing permissions values:

- `prompt` -> `adapter_options.dangerously_skip_permissions: false`
- `bypass` is supported for explicit trusted project opt-in, including `cuekit init --unsafe-bypass`.

Security rule:

Project-local `.cuekit.yaml` is usually committed and cloned, so regular generated config must not silently enable permission bypass. `permissions: bypass` is allowed only as an explicit trusted-project choice, such as manually editing config or running `cuekit init --unsafe-bypass`. Permission bypass can also be requested explicitly per submit call.

If project-local config selects executable behavior, such as `submit.role`, cuekit should force safe permissions for that submitted task unless the caller or trusted user config explicitly opts into bypass. This prevents a cloned repo from combining project-selected profile instructions with adapter built-in bypass defaults.

Precedence:

1. explicit per-submit `adapter_options`;
2. trusted user-level adapter defaults, if introduced later;
3. safe project-local adapter defaults such as `permissions: prompt`;
4. adapter built-in defaults.

## Persistence model

The global DB remains the source of truth. To make config-based filtering efficient and stable, session rows should eventually store additional identity fields, for example:

```ts
config_root?: string;
project_id?: string;
project_name?: string;
project_uid?: string;
```

For backward compatibility:

- existing sessions without `project_id` continue to match by `project_root` / path fallback;
- new sessions created under `.cuekit.yaml` store `project_id`, `config_root`, and optionally `project_uid`;
- TUI project scope should match the safe identity, preferably `project_uid` or `(config_root, project_id)`, and include legacy `project_root = configRoot` rows during migration.

## TUI scoping behavior

Recommended behavior after implementation:

1. Load `.cuekit.yaml` if present.
2. Determine effective scope:
   - CLI `--all` / `--path` overrides config;
   - otherwise `tui.scope` if it is `project` or `path`;
   - otherwise `project`.
3. Query tasks by:
   - safe YAML identity (`project_uid` or `(config_root, project_id)`) for project scope;
   - `project_root` / path root for path scope;
   - no project filter for all scope.

This keeps the default safe while still allowing intentional global views.

## Validation and errors

- Malformed YAML should fail loudly with a clear file path and parse message.
- Unknown top-level keys should be rejected or warned consistently; recommendation: reject in CI/tests, warn in interactive CLI if strict mode is not yet available.
- Unknown enum values should be `invalid_input` at command boundaries.
- Config should not be silently ignored if found but invalid.

## Implementation phases

### Phase 1: Config loader and project identity

- Add `.cuekit.yaml` parser/schema.
- Add project root/config root discovery.
- Add docs and example config.
- Do not change submit behavior yet.

### Phase 2: TUI scope

- Store or compute project identity for sessions.
- Make `cuekit tui` use YAML project scope by default.
- Keep `--path` and `--all` overrides.
- Preserve fallback for sessions created before config support.

### Phase 3: Submit defaults

- Apply `submit.role` before role/profile resolution as the role selector fallback, but force safe permissions for project-config-selected roles unless explicit caller input or trusted user config opts into bypass.
- Apply `submit.agent` and `submit.model` only after profile resolution, filling values that explicit input and the selected profile did not provide.
- Apply only safe project-local adapter permission defaults unless explicit adapter options are provided. Do not honor project-local `permissions: bypass` until a trust mechanism exists.

### Phase 4: Team defaults

- Apply `teams.roles` in `submit_team_tasks` for tasks with `position` and omitted `role`.
- Apply `teams.wait` defaults in `wait_team`.
- Leave `teams.cleanup: delete-empty-team` inactive until a `delete_team` operation exists.

### Phase 5: Project init command

Add a human-facing `cuekit init` command to scaffold the safe project-local configuration that this design defines.

#### Command name

Use `init`, not `setup`.

- `init` matches the action: initialize the current directory as a cuekit-aware project by creating project-local files.
- It follows familiar command naming (`npm init`, `git init`, `tsc --init`, `biome init`).
- `setup` should remain available for broader environment setup in the future, such as MCP registration, dependency checks, or machine-level configuration.

#### Scope

`cuekit init` should be a human CLI command only. Do not add it to MCP operations unless there is a concrete agent workflow that needs to initialize repositories through MCP.

Initial behavior:

1. Create `.cuekit.yaml` in the current directory.
2. Add `.cuekit/tasks/` to `.gitignore`.
3. Refuse to overwrite existing files unless explicitly requested.
4. Print a concise summary of files created or updated.

#### Generated `.cuekit.yaml`

The generated config must be safe by default and equivalent in spirit to `.cuekit.example.yaml`.

Recommended generated fields:

```yaml
project:
  id: <directory-name-as-safe-id>
  name: <directory-name>

# Scope TUI views to this project by default.
tui:
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
    permissions: prompt
  opencode:
    permissions: prompt
```

Notes:

- `project.id` should be derived from the current directory name and sanitized to the existing project id pattern.
- Include commented `submit` defaults to make the default role/agent/model/timeout behavior discoverable; explicit submit request fields still win.
- Include commented Task Teams role and wait defaults so initialized projects are ready for coordinator/worker/reviewer teams.
- Do not generate `permissions: bypass` unless `cuekit init --unsafe-bypass` is explicitly requested.
- `teams.cleanup: delete-empty-team` must not be generated while `delete_team` does not exist.

#### `.gitignore` behavior

`cuekit init` should ignore local task artifacts without hiding commit-worthy project config or Agent Profiles.

Add this entry if absent:

```gitignore
# cuekit local task artifacts
.cuekit/tasks/
```

Rules:

- Do not ignore `.cuekit/` as a whole, because `.cuekit/agents/*.md` may be intentional project Agent Profiles.
- Create `.gitignore` if it does not exist.
- Preserve existing `.gitignore` content.
- Do not add duplicate `.cuekit/tasks/` entries.
- Provide `--no-gitignore` to skip this update.

#### Options

Recommended initial options:

- `--dry-run`: print the files/content that would be written without changing disk.
- `--force`: overwrite an existing `.cuekit.yaml`.
- `--no-gitignore`: do not create or modify `.gitignore`.
- `--unsafe-bypass`: generate `adapters.<agent>.permissions: bypass` for trusted repositories and print a warning.

Future options can include an interactive mode, but the first implementation should be deterministic and scriptable.

#### Error handling

- Existing `.cuekit.yaml` without `--force` should return a clear `invalid_input`-style CLI error and leave files unchanged.
- `--unsafe-bypass` should be visibly explicit in help and should print a warning when used.
- Invalid current directory names should fall back to a safe derived id rather than failing.
- `.gitignore` update failures should fail the command unless `--no-gitignore` is set; partial writes should be avoided where practical.

## Resolved decisions and open questions

Resolved:

1. cuekit should create `.cuekit.yaml` via `cuekit init`; users may still create it manually.
2. Unknown top-level keys are hard schema errors.
3. `project.id` is optional; cuekit derives a safe path-based identity when omitted.
4. `cuekit init --unsafe-bypass` may generate bypass adapter defaults, but regular `cuekit init` remains prompt-safe.

Open:

1. Should config support inheritance from user-level defaults later, such as `~/.cuekit/config.yaml`?
2. Should a future `cuekit init --interactive` ask for submit defaults and team role mappings?
