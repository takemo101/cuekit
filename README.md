# cuekit

Protocol and adapter foundation for orchestrating coding agents. A single [incur](https://github.com/wevm/incur)-based command tree is surfaced as both a CLI and an MCP server, so the same command definitions back `cuekit submit-task ...` from a shell and `submit_task` as an MCP tool call.

## Shape

- `@cuekit/core` — protocol types, Zod schemas, and lifecycle helpers. No runtime dependencies; pure TypeScript.
- `@cuekit/store` — SQLite-backed persistence at `~/.cuekit/state.db` with migrations and typed row decoding.
- `@cuekit/adapters` — runtime bindings. v0 ships a `tmux`-pane backend with adapters for claude-code (working spike), pi, and opencode (stubs).
- `@cuekit/mcp` — control surface. The `cuekit` binary.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer
- `tmux` on `PATH` (children run in tmux sessions so you can `tmux attach` to debug them live)

## v0 scope

| Supported | Deferred |
|---|---|
| `submit_task` / `get_task_status` / `get_task_result` / `cancel_task` | Workflow engine, kanban, swarm OS |
| `list_tasks` / `list_adapters` | Distributed worker pools, DAG scheduling |
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

Command names are kebab-case; option names follow the Zod schema (snake_case).

```sh
cuekit list-adapters
# → { adapters: [ { agent_kind: "claude-code", supports_attach: true, ... } ] }

cuekit submit-task --objective "add retry logic to src/api/client.ts" \
                   --agent_kind claude-code \
                   --model sonnet \
                   --cwd /path/to/repo
# → { accepted: true, task_id: "t_abc...", agent_kind: "claude-code", session_id: "s_..." }

cuekit get-task-status --task_id t_abc...
# → { task_id, status: "running", attach_hint: "tmux attach-session -t cuekit-task-t_abc...", ... }

# The attach_hint is a real command you can run in another terminal:
tmux attach-session -t cuekit-task-t_abc...

cuekit steer-task --task_id t_abc... --message "also cover exponential backoff"

cuekit cancel-task --task_id t_abc...

cuekit get-task-result --task_id t_abc...
# → { ok: true, value: { status: "cancelled", summary: "...", artifacts: [...] } }

cuekit list-tasks --status running
```

Every command accepts `--help`, `--llms` / `--llms-full` (machine-readable manifest for LLM-friendly CLIs), `--schema` (JSON Schema for the command input), and `--format` (toon / json / yaml / md / jsonl) via incur.

## MCP

Start the stdio MCP server:

```sh
cuekit --mcp
```

Agents that speak MCP can list the `submit_task` / `get_task_status` / `get_task_result` / `cancel_task` / `list_tasks` / `list_adapters` / `steer_task` tools and call them over stdio. See the [incur docs](https://github.com/wevm/incur) for auto-registration via `cuekit mcp add`.

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
