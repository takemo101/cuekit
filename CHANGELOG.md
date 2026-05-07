# Changelog

All notable changes to cuekit are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
cuekit is pre-v0.1. Releases are tagged on GitHub (`v0.0.x`) and pulled
via `bun install -g github:takemo101/cuekit#vX.Y.Z`. Breaking changes
*are* tracked here because early adopters building against `main` can
still be affected.

## [Unreleased]

## [0.0.2] — 2026-05-08

### Added

- **`@cuekit/adapters/gemini-adapter`**: Google Gemini CLI adapter with
  first-class interactive + batch run modes, unconditional `--skip-trust`
  (Gemini's per-directory trust gate is not auto-skipped in non-TTY mode
  unlike Claude Code), `-y` (yolo) defaulted on through the shared
  `shouldDangerouslySkipPermissions` helper, and curated
  `availableModels` list (`gemini-2.5-pro`, `gemini-2.5-flash`,
  `gemini-2.5-flash-lite`). Registered in `@cuekit/mcp` alongside
  claude-code / pi / opencode / jcode and exposed through `cuekit doctor`.
  Pairs with [`docs/designs/cuekit-gemini-adapter-design.md`] and
  [`docs/guides/gemini-adapter.md`].
- **`adapter_options.approval_mode`** (Gemini-only): exposes Gemini's
  full 4-value `--approval-mode` surface (`default` / `auto_edit` /
  `yolo` / `plan`). `plan` is API-level read-only, useful for reviewer
  / audit children that must structurally not call edit tools. Wins
  over the binary `dangerously_skip_permissions` toggle when set;
  invalid values fall back silently.
- **`adapter_options.cleanup_on_terminal_report`** (all pane adapters):
  opt-in that asks `report_task_event` to call the adapter's
  `cleanup()` (kill the tmux session) the moment a terminal child
  report (`completed` / `failed` / `blocked`) is committed. Default
  behavior is preserved when the option is absent. Most useful for
  Gemini, whose REPL has no clean self-exit path.
- **`cuekit init` template**: generated `.cuekit.yaml` now lists a
  `gemini:` adapter block alongside `claude-code:` and `opencode:`,
  with an inline note that `--skip-trust` is unconditional and
  `permissions` only governs `-y`.

### Changed

- **`wait-tasks` cwd validation is now opt-in.** Previously a caller
  who omitted both `cwd` and `session_id` had the MCP server's
  `process.cwd()` silently applied as scope, producing
  `permission_denied: task '...' is outside cwd '<server cwd>'` for
  callers that submitted a task and waited on it without re-passing
  scope. Now omitting `cwd` skips scope validation entirely; explicit
  `cwd` mismatch still rejects with `permission_denied`. Brings
  `wait-tasks` in line with `get_task_status` (which has no scope).
- **`--task_ids` / `--session_ids` accept comma-separated values**
  in addition to the documented repeat-flag form. `cuekit task delete
  --task_ids "t_a,t_b"` now works as users naturally expect; mixed
  forms (`--task_ids t_a --task_ids t_b,t_c`) flatten correctly. MCP
  callers passing `task_ids: ["t_a", "t_b"]` are unaffected.

### Documentation

- Top-level README, `docs/README.md`, `docs/guides/README.md`,
  AGENTS.md and a new redirect-only CLAUDE.md were rewritten for
  scannability and consolidated into a single source of truth.
- New design notes: gemini adapter (with trusted-folder handling).
- New guide: `docs/guides/gemini-adapter.md` covering submit /
  attach / steer / batch-mode steering rejection / cleanup, plus
  read-only review mode and auto-cleanup sections.
- Implementation plan: `docs/plans/2026-05-07-gemini-adapter-implementation-plan.md`.

## [0.0.1] — 2026-05-04

Initial GitHub-distributed release. The full set of features that
shipped under this tag is recorded below; subsequent versions only
list deltas relative to the previous tag.

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
