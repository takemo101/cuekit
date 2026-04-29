# Changelog

All notable changes to cuekit are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
cuekit is pre-v0.1; everything lives under **Unreleased** until the first
tagged release. Breaking changes *are* tracked here because early adopters
building against `main` can still be affected.

## [Unreleased]

### Added

#### Control surface (`@cuekit/mcp`)

- `cuekit` CLI + MCP stdio server, backed by [incur](https://www.npmjs.com/package/incur).
  Grouped CLI commands (`cuekit task submit`, `cuekit adapter list`, ...)
  and flat MCP tools share the same operation handlers and Zod-validated schemas.
- MCP tools (snake_case per spec):
  - `submit_task` — spawn a task on the target adapter; auto-creates a session
    from `cwd` when `session_id` is omitted.
  - `get_task_status`, `get_task_result` — snapshot and terminal-state fetch.
  - `cancel_task`, `steer_task` — cancellation and best-effort steering.
  - `list_tasks` — cross-session listing with filter + keyset pagination.
  - `list_adapters` — registered adapters + their capabilities.
  - `show_mcp_config` — emits the MCP-server stanza operators paste into their
    client config (Claude Code / Desktop / Cursor). `name` + `bin` overrides
    for side-by-side installs and workspace-linked checkouts.
  - `delete_task`, `delete_session` — DB-hygiene ops. Policy: only terminal
    tasks can be deleted; sessions with active children are refused.
- End-to-end test (`mcp-stdio-integ`) drives a real subprocess over
  newline-delimited JSON-RPC to catch failure modes unit tests miss.

#### Adapters (`@cuekit/adapters`)

- `AgentAdapter` contract + `AdapterRegistry`.
- Tmux-based `PaneBackend` — 1 task = 1 tmux session (`cuekit-task-<id>`);
  operator attaches interactively for debugging, cuekit steers via `send-keys`.
- Shared `pane-adapter` factory — concentrates launch-command knowledge in each
  runtime's `buildLaunchCommand` callback; cancellation, steering, attach-hint
  emission, transcript capture, and model validation are all shared.
- Concrete adapters:
  - `claude-code` — `claude` CLI launched inside a pane, with hybrid model
    validation (`available_models` declared by the adapter).
  - `pi`, `opencode` — stub adapters following the same contract.
- `FakeTmuxRunner` for testable adapter unit tests without a real tmux.
- `AgentAdapter.list()` returns only the adapter's own tasks; a caller-
  supplied `agent_kind` that conflicts with the adapter is now rejected
  loud instead of silently rewritten.

#### Persistence (`@cuekit/store`)

- SQLite-backed store (`bun:sqlite`) with idempotent migrations, tracked in
  a `schema_migrations` bootstrap table.
- Session + task schemas with FK integrity; transcript/result refs stored
  separately so `completeTask` can preserve them across the lifecycle.
- Cross-session `listTasks` with **keyset pagination** on
  `(updated_at desc, id asc)` — stable under concurrent inserts, O(log N)
  seek via the `idx_tasks_updated_at_id` composite index.
- Opaque `TaskListCursor` (base64url JSON) in `@cuekit/core` so callers
  round-trip `next_cursor` exactly without hand-crafting.
- Low-level `deleteTask` + `deleteSession` (cascading, transactional).

#### Protocol (`@cuekit/core`)

- Zod schemas for every message on the MCP surface — `TaskSpec`,
  `TaskStatus`, `TaskLifecycle`, `TaskStatusView`, `TaskResult`,
  `SteeringMessage`, `Ack`, `JobError`, `AdapterCapabilities`,
  `ArtifactRef`, `InputRef`, `ExpectedOutput`, `TaskListFilter`,
  `TaskListCursor`, `TaskSummary`.
- `Logger` abstraction (debug/info/warn/error) with an opt-in
  stderr-backed factory. `safeStringify` expands `Error` via
  non-enumerable properties so `{ err }` actually logs the reason.
  `parseLogLevel` validates `CUEKIT_LOG_LEVEL` instead of silently
  accepting typos.
- `taskArtifactPaths(cwd, task_id)` — single source of truth for
  `.cuekit/tasks/<id>/transcript.*` + `result.json` paths.

### Changed

- **MCP tool names**: kebab → snake_case across the board
  (`submit-task` → `submit_task`, etc.) to match the cuekit spec.
- **CLI command names**: flat snake_case commands were replaced with grouped
  resource commands (`cuekit submit_task` → `cuekit task submit`,
  `cuekit list_adapters` → `cuekit adapter list`, etc.). Flat CLI aliases are
  not provided. MCP tool names remain flat snake_case.
- **`listTasks` pagination**: OFFSET → keyset on `(updated_at desc, id asc)`.
  Concurrent inserts mid-walk can no longer shift the window, eliminating
  the skip/duplicate class of bugs. Breaking for `list_tasks` callers:
  `offset` / `next_offset` are gone; use `cursor` / `next_cursor` instead.
- **`list_tasks` output**: now carries `has_more: boolean` (always) and
  `next_cursor?: string` (present only when another page exists) — MCP
  clients no longer have to guess whether a page was truncated.

### Fixed

- **`completeTask` erasing refs** — the function blindly nulled
  `summary` / `result_ref` / `transcript_ref` when callers omitted them,
  wiping values set earlier in the lifecycle (e.g. transcript_ref at
  submit time). It's now a partial update; omitted fields are preserved,
  explicit `null` clears.
- **`pane-adapter.list` silently rewriting `agent_kind`** — an MCP
  client calling `adapter.list({ agent_kind: "pi" })` on the claude-code
  adapter got claude-code tasks with no error. Throws loud now.
- **`bin.ts` closing the DB after `cli.serve()` in `--mcp` mode** —
  incur resolves `serve()` as soon as stdio wiring is done, not when the
  server shuts down. The subsequent close broke every subsequent tool
  call with `Cannot use a closed database`. DB is now held open for the
  process lifetime; signal handlers clean up on exit.
- **`resolveSessionId` recording the child adapter as `parent_agent_kind`** —
  auto-created sessions now correctly show the orchestrator (`cuekit-cli`)
  as the parent, not the child being dispatched to.
- **Cross-adapter task operations** — `status` / `steer` / `cancel` /
  `collect` no longer operate on tasks belonging to other adapters.
- **`CUEKIT_LOG_LEVEL` silent footgun** — unknown values used to bypass
  the level filter entirely (emitting every level). Now validated by
  `parseLogLevel`; unrecognised values fall back to `warn`.
- **`limit: 0 = unbounded`** — user-hostile; every other JSON API reads
  `limit: 0` as "zero rows," and a typo defeated the cap. Removed.
  Callers that need more than 1000 rows now page via cursor.
- **`offset` without `limit`** — was silently interpreted as "skip N,
  take default 100." Rejected at schema level now. *(Obsoleted by the
  keyset migration but kept here for any early adopter who pinned
  against an intermediate commit.)*
