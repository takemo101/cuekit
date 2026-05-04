# cuekit

Protocol and adapter foundation for orchestrating coding agents. A single schema-backed control surface powers grouped human CLI commands such as `cuekit task submit ...` and a compact grouped MCP tool surface for AI callers.

## Shape

- `@cuekit/core` — protocol types, Zod schemas, and lifecycle helpers. No runtime dependencies; pure TypeScript.
- `@cuekit/store` — SQLite-backed persistence at `~/.cuekit/state.db` with migrations and typed row decoding.
- `@cuekit/adapters` — runtime bindings. v0 ships a `tmux`-pane backend with adapters for claude-code (working spike), pi, opencode (stub), and jcode REPL. The jcode adapter uses `jcode repl` for the same attach/steer workflow; see [`docs/issues/cuekit-jcode-repl-adapter-design.md`](docs/issues/cuekit-jcode-repl-adapter-design.md).
- `@cuekit/mcp` — control surface. The `cuekit` binary.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer
- `tmux` on `PATH` with `new-session -e` support (children run in tmux sessions so you can `tmux attach` to debug them live)

## v0 scope

| Supported | Deferred |
|---|---|
| `submit_task` / `get_status` / `get_task_result` / `wait` / `cancel_tasks` | Workflow engine, kanban, swarm OS |
| grouped `list` / `cleanup` / `delete` MCP tools | Distributed worker pools, DAG scheduling |
| `steer_task` (best-effort, adapter-dependent) | Remote tenancy / auth model |
| tmux attach for every running task | Cost accounting, long-term memory |

See [`docs/specs/README.md`](docs/specs/README.md) for the full v0 protocol.

## Install

Clone and install from workspace:

```sh
git clone https://github.com/takemo101/cuekit
cd cuekit
bun install
```

`cuekit` is exposed as the binary of `@cuekit/mcp`. For local use, register the binary globally:

```sh
cd packages/mcp && bun link    # adds `cuekit` to ~/.bun/bin/
```

Or run it directly without linking:

```sh
bun packages/mcp/src/bin.ts <command> ...
```

## CLI

CLI commands are grouped by resource for humans. Option names remain snake_case. MCP tool names stay flat snake_case for tool-using agents; flat CLI aliases such as `cuekit submit_task` are not supported.

```sh
cuekit adapter list
# → { adapters: [ { agent_kind: "claude-code", supports_attach: true, ... } ] }

cuekit task submit --objective "add retry logic to src/api/client.ts" \
                  --agent_kind claude-code \
                  --model sonnet \
                  --cwd /path/to/repo
# → { accepted: true, task_id: "t_abc...", agent_kind: "claude-code", session_id: "s_..." }

# claude-code and opencode default to runtime permission bypass so delegated
# panes do not stall. Disable it per task when you want runtime prompts.
cuekit task submit --objective "run with prompts" \
                  --agent_kind opencode \
                  --adapter_options '{"dangerously_skip_permissions":false}'

cuekit task status --task_id t_abc...
# → { task_id, status: "running", attach_hint: "tmux attach-session -t cuekit-task-t_abc...", ... }

# The attach_hint is a real command you can run in another terminal:
tmux attach-session -t cuekit-task-t_abc...

cuekit task steer --task_id t_abc... --message "also cover exponential backoff"

cuekit task cancel --task_id t_abc...

cuekit task result --task_id t_abc...
# → { task_id: "t_abc...", status: "cancelled", summary: "...", files_changed: [], artifacts: [...] }

cuekit task wait --task_ids t_abc... --session_id s_abc... --mode all
# → { done: true, timed_out: false, tasks: [ { task_id: "t_abc...", status: "completed", ... } ] }

cuekit task list --status running
```

### Agent profiles

Use `role` to submit a task with focused child-agent instructions. Profiles are discovered from builtins, `~/.cuekit/agents/*.md`, and `<project-root>/.cuekit/agents/*.md`; project profiles override user profiles, which override builtins.

```sh
cuekit agent list

cuekit task submit --objective "review this diff" \
                  --role reviewer \
                  --cwd /path/to/repo

cuekit task submit --objective "debug the failing auth tests" \
                  --role auto \
                  --cwd /path/to/repo
```

Explicit `--agent_kind` / `--model` override profile defaults. `role: "auto"` uses deterministic keyword selection and records the selected role plus reason in task status/list output; the TUI detail pane shows role/source/model when present. See [Agent Profiles](docs/guides/agent-profiles.md).

### Project config

Add `.cuekit.yaml` to a repository to define project identity, safe submit defaults, TUI scope, and Task Teams defaults. The recommended starting point is:

```sh
cuekit init
```

This creates a safe `.cuekit.yaml` and adds `.cuekit/tasks/` to `.gitignore` for local task artifacts. You can also start from [`.cuekit.example.yaml`](.cuekit.example.yaml). See [Project Config](docs/guides/project-config.md).

By default, generated project config uses prompt-safe adapter permissions. Use `cuekit init --unsafe-bypass` only for trusted repositories when you intentionally want project-local adapter defaults to request bypass behavior. Project-derived role/agent defaults still force prompt-safe adapter options unless a caller explicitly supplies `adapter_options`.

Every command accepts `--help`, `--llms` / `--llms-full` (machine-readable manifest for LLM-friendly CLIs), `--schema` (JSON Schema for the command input), and `--format` (toon / json / yaml / md / jsonl) via incur.

### Human TUI

`cuekit tui` opens an interactive task cockpit for human operators. The normal CLI remains optimized for agents/scripts with TOON output; the TUI is a separate terminal UI for browsing and acting on tasks.

```sh
cuekit tui
```

Keys:

```text
↑/↓ or j/k  select task
r           refresh
a           attach to selected task's tmux session and exit TUI
s           steer selected task
c           cancel selected non-terminal task
d           delete selected terminal task
q or Esc    quit
```

Attach is one-way in the MVP: pressing `a` restores the terminal, runs `tmux attach-session -t <session>`, and does not return to the TUI after you detach.

## MCP

Start the stdio MCP server:

```sh
cuekit --mcp
```

Agents that speak MCP can list the compact grouped tool surface: `submit_task`, `submit_team_tasks`, `create_team`, `get_status`, `get_task_result`, `wait`, `cancel_tasks`, `list`, `report_task_event`, `steer_task`, `cleanup`, and `delete`. Use `cuekit mcp config` from the human CLI to print a client configuration snippet; setup helpers are not exposed as MCP tools.

`wait` is the parent-side polling primitive for asynchronous delegation. Use `kind: "tasks"` with `task_ids: [task_id]` for one or more tasks, or `kind: "team"` with `team_id` for a team snapshot. Prefer short bounded waits such as `{ "kind": "tasks", "task_ids": ["t_..."], "timeout_ms": 30000, "poll_interval_ms": 5000 }` and poll again rather than one very long MCP request. Waiting is scoped by `session_id` or the current/explicit `cwd`; a wait timeout only stops waiting and does not cancel child work.

When a bounded wait times out, call `get_status` for the task or team. If a task includes `attention_hint` (for example `stop_hook_or_idle_prompt_suspected`), use `steer_task` with a short instruction such as “please report progress or finish now”. Inspect durable child reports with `list({ "kind": "events", "task_id": "t_..." })`.

## State

- **Global state index**: `~/.cuekit/state.db` — SQLite database with two tables (`sessions`, `tasks`) and a `schema_migrations` tracker. One connection per process; WAL mode, `foreign_keys = ON`.
- **Per-task artifacts**: `<worktree>/.cuekit/tasks/<task_id>/` — transcript capture (`transcript.txt`), any runtime-emitted `result.json`, and anything else the adapter drops there. Paths are stored as `transcript_ref` / `result_ref` on the task row.
- **tmux sessions**: one session per task named `cuekit-task-<id>`. Killed on terminal transition or explicit cancel.

## Execution model

Every task runs in its own dedicated tmux session (not headless), so:

1. The orchestrator can submit / cancel / steer programmatically via tmux commands.
2. You can `tmux attach-session -t cuekit-task-<id>` from any terminal to watch the child agent live.
3. The transcript is captured via `tmux pipe-pane` and persists even after the session is killed.

See [`docs/specs/2026-04-23-cuekit-adapter-spec.md`](docs/specs/2026-04-23-cuekit-adapter-spec.md) §3.7 for the full pane-backend contract.

## Design references

- Specs: [`docs/specs/README.md`](docs/specs/README.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md)
- Implementation plan: [`docs/plans/2026-04-23-cuekit-implementation-plan.md`](docs/plans/2026-04-23-cuekit-implementation-plan.md)

## Development

```sh
bun run typecheck     # tsc --noEmit across all packages
bun run test          # bun:test across all packages
bun run check         # Biome lint + format check
bun run fix           # Biome auto-fix
```

Tests use `FakeTmuxRunner` (exported from `@cuekit/adapters`) so the default run does not require `tmux`. A small integration suite in `@cuekit/adapters` exercises real tmux when available and skips otherwise.

### Manual smoke tests

See [`docs/guides/jcode-adapter.md`](docs/guides/jcode-adapter.md) for a real-runtime `jcode repl` smoke test covering submit, tmux attach, steering, transcript capture, and cleanup.

#### Real `claude`

The automated suite stubs the child runtime with `sleep` so it never calls Anthropic. To verify the adapter end-to-end against the real `claude` CLI:

```sh
# One-time setup
just install      # registers `cuekit` globally

# In a real repo where you want the child to work:
cuekit task submit --objective "explain this repo in one paragraph" \
                  --agent_kind claude-code \
                  --model sonnet

# Returns a task_id. Attach to the live child:
tmux attach-session -t cuekit-task-<task_id>
# Ctrl-b d detaches; the task keeps running.

cuekit task status --task_id <task_id>
cuekit task cancel --task_id <task_id>
```

The transcript is piped to `<cwd>/.cuekit/tasks/<task_id>/transcript.txt` and stays after the session is killed.
