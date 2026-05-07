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
- `tmux` on `PATH` with `new-session -e` support — children run in tmux sessions you can `tmux attach` into

## Install

```sh
bun install -g github:takemo101/cuekit#v0.1.0
cuekit doctor
cuekit mcp config   # prints the snippet to register cuekit with your MCP client
```

Use an immutable release tag (`#v0.1.0`, etc.). Avoid floating `#main` outside development — Bun's caching semantics for branches are less explicit. After installing a newer tag, restart MCP clients.

`cuekit update` reads the latest GitHub Release tag and prints the exact `bun install` command to run. It is **advisory-only** and does not self-update.

For local development:

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
tmux attach-session -t cuekit-task-t_abc...

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
↑/↓ or j/k  select task        a  attach to tmux session (one-way; exits TUI)
r           refresh            s  steer selected task
c           cancel selected    d  delete terminal task
q / Esc     quit
```

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

## State

| Where | What |
|---|---|
| `~/.cuekit/state.db` | global SQLite index — `sessions`, `tasks`, `schema_migrations`. WAL mode, `foreign_keys = ON`, one connection per process. |
| `<worktree>/.cuekit/tasks/<task_id>/` | per-task artifacts: `transcript.txt`, runtime-emitted `result.json`, anything else the adapter drops. Stored as `transcript_ref` / `result_ref` on the task row. |
| `cuekit-task-<id>` | one tmux session per task. Killed on terminal transition or explicit cancel. |

## Packages

| Package | Purpose |
|---|---|
| `@cuekit/core` | Protocol types, Zod schemas, lifecycle helpers. No runtime deps. |
| `@cuekit/store` | SQLite persistence at `~/.cuekit/state.db` with migrations. |
| `@cuekit/adapters` | Runtime bindings. v0 ships a tmux-pane backend with adapters for claude-code, pi, opencode (stub), `jcode repl`, and gemini. |
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

Tests use `FakeTmuxRunner` (exported from `@cuekit/adapters`) so the default run does not require `tmux`. A small integration suite in `@cuekit/adapters` exercises real tmux when available and skips otherwise.

### Manual smoke tests

Adapter end-to-end checks against real runtimes are documented per adapter:

- [jcode adapter smoke test](docs/guides/jcode-adapter.md)
- Real `claude` CLI: `just install`, then submit a task with `--agent_kind claude-code` and `tmux attach-session -t cuekit-task-<id>`. The transcript persists at `<cwd>/.cuekit/tasks/<task_id>/transcript.txt` after the session is killed.

## v0 scope

| Supported | Deferred |
|---|---|
| `submit_task` / `get_status` / `get_task_result` / `wait` / `cancel_tasks` | Workflow engine, kanban, swarm OS |
| Grouped `list` / `cleanup` / `delete` MCP tools | Distributed worker pools, DAG scheduling |
| `steer_task` (best-effort, adapter-dependent) | Remote tenancy / auth model |
| tmux attach for every running task | Cost accounting, long-term memory |

Full v0 protocol: [`docs/specs/README.md`](docs/specs/README.md).
