# cuekit

A child-agent delegation substrate for coding agents.

cuekit gives a parent agent a stable way to spawn child coding agents, attach to them live via tmux, steer them, collect normalized results, and clean up. The same protocol surface is exposed as a grouped human CLI (`cuekit task ...`) and a grouped MCP tool surface for AI callers.

## Philosophy

cuekit is **not a workflow engine**. The parent agent stays the decision-maker; cuekit is the substrate that makes delegation observable and steerable.

- **Teams** are a lightweight view over related child tasks, not a swarm OS.
- **Strategies** are development playbooks, not workflow control.
- No automatic scheduling, auto-wake, or auto-steer that replaces parent judgment.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- A terminal multiplexer on `PATH`. By default cuekit uses **tmux** (with `new-session -e` support); children run in tmux sessions you can `tmux attach` into. Alternatively, cuekit can use **[zellij](https://github.com/zellij-org/zellij)** ≥ 0.43 or **[herdr](https://herdr.dev)** ≥ 0.5 by setting `multiplexer.backend: zellij` or `multiplexer.backend: herdr` in `.cuekit.yaml` — see [Multiplexer](#multiplexer) below.

## Install

Pinned to a specific release tag (recommended):

```sh
bun install -g github:takemo101/cuekit#v0.0.7
cuekit doctor
cuekit mcp config   # prints the snippet to register cuekit with your MCP client
```

Or resolve the most recent release tag at install time (no need to look up the version):

```sh
# Option A — uses the GitHub CLI:
bun install -g github:takemo101/cuekit#$(gh release view --repo takemo101/cuekit --json tagName -q .tagName)

# Option B — curl-only:
bun install -g github:takemo101/cuekit#$(curl -s https://api.github.com/repos/takemo101/cuekit/releases/latest | jq -r .tag_name)
```

Bun has no `#latest` shorthand for GitHub installs, so the one-liners above resolve the tag at command-execution time and pin the install to that exact version. After install, `cuekit update` is the advisory-only command that prints the next install command when a newer release exists.

Use an immutable release tag for normal installs. Avoid floating `#main` outside development — Bun's caching semantics for branches are less explicit. After installing a newer tag, restart MCP clients.

> **Naming gotcha**: the binary is named `cuekit` but the workspace `package.json#name` is `cuekit-workspace`. This matters when you uninstall (see below) and when you list installed packages (`bun pm ls -g | grep cuekit`).

### Uninstall

```sh
bun remove -g cuekit-workspace
```

`bun remove -g cuekit` is a **silent no-op** because no package by that name exists — Bun returns success without removing anything. Always remove by the package name `cuekit-workspace`. Verify with `which cuekit` (should report nothing) or `bun pm ls -g | grep cuekit-workspace` (should be empty).

For a deeper cleanup including state, transcript, and tmux sessions, see the uninstall recipe at the bottom of this file.

### Local development

```sh
git clone https://github.com/takemo101/cuekit
cd cuekit
bun install
bun link                              # exposes `cuekit` from the workspace
# or run directly:
bun packages/cli/src/bin.ts <command>
```

## Quick start

```sh
# Submit a child agent task in your repo:
cuekit task submit \
  --objective "add retry logic to src/api/client.ts" \
  --agent_kind claude-code \
  --model sonnet \
  --cwd /path/to/repo
# → { task_id: "t_abc...", attach_hint: "tmux attach-session -t cuekit-task-t_abc..." }

# Watch the child live in another terminal:
cuekit task status --task_id t_abc... --format json | jq -r '.attach_hint'
# → use the printed attach command (tmux/zellij/herdr attach)

# Steer it without attaching:
cuekit task steer --task_id t_abc... --message "also cover exponential backoff"

# Collect the normalized result:
cuekit task result --task_id t_abc...
```

## CLI

Commands are grouped by resource. Option names are `snake_case`. Every command accepts `--help`, `--llms` / `--llms-full` (machine-readable manifest), `--schema`, and `--format` (`toon` / `json` / `yaml` / `md` / `jsonl`).

| Group | Examples |
|---|---|
| `task` | `submit`, `status`, `steer`, `cancel`, `result`, `wait`, `list` |
| `team` | `create`, `submit`, `start`, `result`, `steer`, `delete` |
| `agent` | `list` (discover role profiles) |
| `adapter` | `list` (runtime capabilities) |
| `tui` | interactive task cockpit |
| `mcp` | `config` (print MCP client snippet) |
| top-level | `init`, `doctor`, `update` |

Flat aliases like `cuekit submit_task` are intentionally not supported — only MCP tool names use that flat form.

### Agent profiles

Use `--role` to submit with focused child-agent instructions. Profiles resolve in this order: project (`<repo>/.cuekit/agents/*.md`) → user (`~/.cuekit/agents/*.md`) → builtins. `--agent_kind` / `--model` override profile defaults.

```sh
cuekit agent list
cuekit task submit --objective "review this diff" --role reviewer --cwd /path/to/repo
cuekit task submit --objective "debug the failing auth tests" --role auto --cwd /path/to/repo
```

`role: "auto"` uses deterministic keyword selection and records the chosen role and reason in task status. See [Agent Profiles guide](docs/guides/agent-profiles.md).

### Project config

```sh
cuekit init   # writes a safe .cuekit.yaml and adds .cuekit/tasks/ to .gitignore
```

`.cuekit.yaml` defines project identity, safe submit defaults, TUI scope, and Task Teams defaults. The generated file uses prompt-safe adapter permissions; pass `cuekit init --unsafe-bypass` only in trusted repos when you want project-local defaults to request bypass behavior. Project-derived role/agent defaults still force prompt-safe adapter options unless a caller explicitly supplies `adapter_options`. See [Project Config guide](docs/guides/project-config.md) and [`.cuekit.example.yaml`](.cuekit.example.yaml).

### TUI

`cuekit tui` opens an interactive task cockpit for humans. The flat CLI stays optimized for agents/scripts; the TUI is a separate surface for browsing and acting.

```text
↑/↓ or j/k  select task        a  attach to task pane/session (one-way; exits TUI)
t           switch tasks/teams A  attach selected team dashboard (teams mode)
r           refresh            s  steer selected task
c           cancel selected    d  delete terminal task / empty team
q / Esc     quit
```

The task detail panel's `LIVE OUTPUT` section sources from the running task's multiplexer pane (e.g. `tmux capture-pane`) so the rendered screen matches what `tmux attach` would show — useful for TUI children (Gemini CLI, opencode TUI) whose output gets buried by redraws in the persisted transcript. Terminal tasks fall back to the file-tail. The header indicates which source is active. See [`docs/designs/cuekit-tui-live-pane-transcript-design.md`](docs/designs/cuekit-tui-live-pane-transcript-design.md).

## MCP

Start the stdio server:

```sh
cuekit --mcp
```

Grouped tool surface: `submit_task`, `submit_team_tasks`, `start_team_strategy`, `create_team`, `get_status`, `get_task_result`, `get_team_result`, `wait`, `cancel_tasks`, `list`, `report_task_event`, `steer`, `steer_task`, `steer_team`, `cleanup`, `delete`.

- `list({ kind: "tasks" | "teams" | "events" | "adapters" | "agent_profiles" | "strategies" })` — pass `cwd` for project-local strategy discovery.
- `steer({ kind: "task" | "team", ... })` — preferred. `steer_task` / `steer_team` remain as compatibility aliases.
- `delete({ kind: "team", ... })` — for empty teams only.
- `cuekit mcp config` is CLI-only; no MCP setup helpers are exposed as tools.

### Waiting on child work

`wait` is the parent-side polling primitive. Prefer **short bounded waits** over one long request:

```jsonc
{ "kind": "tasks", "task_ids": ["t_..."], "timeout_ms": 30000, "poll_interval_ms": 5000 }
```

A wait timeout only stops waiting; child work keeps running. Team waits are snapshot-based by default — coordinator-led / strategy-backed teams that submit workers after waiting begins can pass `follow_new_tasks: true`.

When a bounded wait times out, call `get_status`. If a task includes `attention_hint` (e.g. `stop_hook_or_idle_prompt_suspected`), use `steer({ kind: "task", ... })` with a short instruction. Inspect durable child reports with `list({ kind: "events", task_id: "t_..." })`.

## Execution model

Pane adapters default to **interactive** mode: the child runs in a dedicated `cuekit-task-<id>` tmux session so cuekit can attach, steer, and capture transcripts while the runtime stays alive.

For single-shot jobs, opt into batch mode per task:

```sh
cuekit task submit --objective "review this diff once and exit" \
                   --agent_kind claude-code \
                   --adapter_options '{"mode":"batch"}'
```

Batch tasks still run in a pane and are attachable, but `metadata.adapter_mode: "batch"` and `supports_steering: false`; `steer_task` rejects them with `steering_unsupported`. Adapter list reports default capabilities; task status reports the actual mode chosen.

### Adapter defaults

- `claude-code` defaults to runtime permission bypass so delegated panes don't stall.
- `opencode` defaults to its interactive TUI; permission bypass applies only to opt-in batch/run mode.
- `gemini` defaults to runtime permission bypass (`-y`) and always passes `--skip-trust` so unattended panes don't stall on the trusted-folder gate.

See [`docs/specs/2026-04-23-cuekit-adapter-spec.md`](docs/specs/2026-04-23-cuekit-adapter-spec.md) §3.7 for the full pane-backend contract.

### Multiplexer

cuekit defaults to **tmux** as the terminal multiplexer. Projects can opt into **zellij** ≥ 0.43 via `.cuekit.yaml`:

```yaml
multiplexer:
  backend: zellij # default is "tmux"
  strict: false   # optional. true → hard-fail when zellij is missing instead of soft-falling-back to tmux
```

Behavioural differences when `multiplexer.backend: zellij` is active:

- Solo tasks live in compact `ct-<task_id>` zellij sessions (mirrors the tmux model).
- Team tasks share one compact `ctm-<team_id_suffix>` zellij session. In the TUI, `A` on the team list attaches to this multi-pane dashboard; `a` on a member/task focuses that member pane before attaching to the same dashboard session.
- Attach uses `zellij attach <session-name>` instead of `tmux attach-session`.
- The TUI's transcript pane sources from `zellij action dump-screen` instead of `tmux capture-pane`. Output formatting differs subtly (escape-sequence canonicalisation).
- Zellij pane state queries are slower than tmux on some systems, especially for multi-pane team dashboards. The TUI keeps list navigation responsive by using cached/persisted list rows, debouncing zellij detail loads, and showing a `Loading detail…` spinner while the selected detail refreshes. A small detail-panel lag is expected when zellij is selected.
- When zellij is configured but its binary is missing, cuekit logs a warning and silently falls back to tmux. To turn this into a hard failure (e.g. CI configs that want to surface the missing dependency), set `multiplexer.strict: true`.
- Per-task multiplexer dispatch: a task spawned under one backend stays attachable via that backend even if `.cuekit.yaml` is later switched. The active backend is per-task, recorded at spawn time.

See [`docs/designs/cuekit-multiplexer-backend-design.md`](docs/designs/cuekit-multiplexer-backend-design.md) for the full design and the zellij team-dashboard work tracked under Phase 4.

#### Herdr backend

Projects can also opt into **[herdr](https://herdr.dev)** ≥ 0.5 as the multiplexer:

```yaml
multiplexer:
  backend: herdr
  strict: false
```

Herdr uses **workspaces** instead of sessions. Solo tasks get one workspace each; team tasks share one workspace with **named tabs per position** (for example, coordinator, worker, reviewer). Attach uses `herdr --session <name>`.

Key differences:
- **Team model**: one workspace per team with position-named tabs; same position shares a tab, different positions get separate tabs.
- **Pane IDs**: compacted on close (IDs may shift), so cuekit uses transcript identity verification to avoid closing the wrong pane.
- **Cross-process persistence**: team workspace handles are persisted in `task_teams.metadata_json` so coordinator-spawned members reuse the same workspace even across process restarts.
- **Fallback**: when herdr is missing and `strict: false`, cuekit falls back to tmux with a logged warning.

See [`docs/designs/cuekit-herdr-multiplexer-backend-design.md`](docs/designs/cuekit-herdr-multiplexer-backend-design.md) for the full design.

## State

| Where | What |
|---|---|
| `~/.cuekit/state.db` | global SQLite index — `sessions`, `tasks`, `schema_migrations`. WAL mode, `foreign_keys = ON`, one connection per process. |
| `<worktree>/.cuekit/tasks/<task_id>/` | per-task artifacts: `transcript.txt`, runtime-emitted `result.json`, anything else the adapter drops. Stored as `transcript_ref` / `result_ref` on the task row. |
| `cuekit-task-<id>` | one multiplexer session/workspace per task. Killed on terminal transition or explicit cancel. |

## Packages

| Package | Purpose |
|---|---|
| `@cuekit/core` | Protocol types, Zod schemas, lifecycle helpers. No runtime deps. |
| `@cuekit/store` | SQLite persistence at `~/.cuekit/state.db` with migrations. |
| `@cuekit/adapters` | Runtime bindings. Ships tmux, zellij, and herdr pane backends with adapters for claude-code, pi, opencode (stub), `jcode repl`, and gemini. |
| `@cuekit/agent-profiles` | Role-based child-agent profiles. |
| `@cuekit/project-config` | `.cuekit.yaml` loading, validation, and defaults. |
| `@cuekit/mcp` | MCP server and protocol/control command projection. |
| `@cuekit/cli` | The `cuekit` binary, setup helpers, diagnostics. |
| `@cuekit/tui` | OpenTUI-based human task cockpit. |

## Documentation

The full documentation index is at [`docs/README.md`](docs/README.md).

| Area | When to read |
|---|---|
| [`docs/specs/`](docs/specs/README.md) | What cuekit is — protocol, state model, MCP API, adapter contract. |
| [`docs/architecture/`](docs/architecture/README.md) | How cuekit must be built — package boundaries, coding rules, error taxonomy. |
| [`docs/decisions/`](docs/decisions/) | ADRs and durable design decisions. |
| [`docs/designs/`](docs/designs/README.md) | Stable feature/subsystem designs (teams, strategies, profiles, TUI, ...). |
| [`docs/guides/`](docs/guides/README.md) | Operator/developer guides for implemented features. |
| [`docs/issues/`](docs/issues/README.md) | Active investigations and bug reports. |
| [`docs/plans/`](docs/plans/) | Implementation plans and execution notes. |
| [`docs/references/`](docs/references/README.md) | Local copies of third-party docs (e.g. OpenTUI). |

## Development

```sh
bun run typecheck   # tsc --noEmit across all packages
bun run test        # bun:test across all packages
bun run check       # Biome lint + format check
bun run fix         # Biome auto-fix
```

Tests use `FakeTmuxRunner` and `FakeHerdrRunner` (exported from `@cuekit/adapters`) so the default run does not require `tmux` or `herdr`. A small integration suite in `@cuekit/adapters` exercises real tmux when available and skips otherwise.

### Manual smoke tests

Adapter end-to-end checks against real runtimes are documented per adapter:

- [jcode adapter smoke test](docs/guides/jcode-adapter.md)
- [gemini adapter smoke test](docs/guides/gemini-adapter.md)
- Real `claude` CLI: `just install`, then submit a task with `--agent_kind claude-code` and attach via the hint from `cuekit task status --task_id <id>`. The transcript persists at `<cwd>/.cuekit/tasks/<task_id>/transcript.txt` after the session is killed.

### Cutting a release

Releases are GitHub-tagged (`v0.0.x`) and consumed via `bun install -g github:takemo101/cuekit#vX.Y.Z`. The published binary is the pre-built bundle at `bin/cuekit.js` — `package.json#bin.cuekit` points at it directly, so Bun installs it verbatim.

```sh
# 1. Bump version in every workspace package's package.json (and the
#    project root if it tracks one). Update CHANGELOG.md.
# 2. Verify the bundle is in sync with the new version:
bun run release:check
# 3. If `release:check` reports the bundle was stale, commit the
#    regenerated bin/cuekit.js it produced, then re-run.
# 4. Open the release PR and merge. After merge, tag the merge commit
#    with `vX.Y.Z` and push.
```

`release:check` rebuilds the bundle, fails if the committed `bin/cuekit.js` differs from the freshly-built output (= the bundle was stale), and double-checks that the bundle contains the expected version string. Without this gate v0.0.2 and v0.0.3 both shipped a stale bundle that reported `0.0.1` from its baked-in `package.json` copy — see [#388](https://github.com/takemo101/cuekit/issues/388).

## v0 scope

| Supported | Deferred |
|---|---|
| `submit_task` / `get_status` / `get_task_result` / `wait` / `cancel_tasks` | Workflow engine, kanban, swarm OS |
| Grouped `list` / `cleanup` / `delete` MCP tools | Distributed worker pools, DAG scheduling |
| `steer_task` (best-effort, adapter-dependent) | Remote tenancy / auth model |
| tmux / zellij / herdr attach for every running task | Cost accounting, long-term memory |

Full v0 protocol: [`docs/specs/README.md`](docs/specs/README.md).

## Full uninstall

The basic `bun remove -g cuekit-workspace` (see [Uninstall](#uninstall)) removes only the binary. To wipe state, transcripts, and project artifacts as well:

```sh
# 1. Binary + Bun cache
bun remove -g cuekit-workspace
rm -rf ~/.bun/install/cache/@GH@takemo101-cuekit-*
rm -rf ~/.bun/install/global/node_modules/cuekit-workspace

# 2. Global state DB (task history, sessions, events)
rm -rf ~/.cuekit

# 3. Per-project artifacts (run inside each repo that used cuekit)
find . -name '.cuekit' -type d -prune -exec rm -rf {} +
rm -f ./.cuekit.yaml          # if `cuekit init` was run

# 4. Kill any remaining multiplexer sessions
# tmux:
tmux ls 2>/dev/null | grep cuekit-task | cut -d: -f1 | xargs -I {} tmux kill-session -t {}
# herdr:
herdr workspace list 2>/dev/null | jq -r '.result.workspaces[].workspace_id' | xargs -I {} herdr workspace close {}

# 5. Remove the cuekit entry from MCP client configs
#    Claude Code: `~/.claude.json` → `mcpServers.cuekit`
#    Project:     `<repo>/.mcp.json` → `mcpServers.cuekit`
#    Cursor / Claude Desktop: each client's MCP config
#    Restart the client after editing.
```

Verify the removal:

```sh
which cuekit            # should report nothing
ls ~/.cuekit            # should be "No such file"
tmux ls 2>/dev/null | grep cuekit-  # should be empty
herdr workspace list 2>/dev/null | grep cuekit  # should be empty
```

Step 1 is enough for most cases. Steps 2 and 3 are destructive — back up `transcript.txt` files first if you need them for review or postmortem.

Note: `bun remove -g cuekit` (without `-workspace`) returns success but removes nothing — the workspace package is named `cuekit-workspace` even though its binary is `cuekit`.
