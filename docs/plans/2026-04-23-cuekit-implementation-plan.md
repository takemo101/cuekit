# cuekit Implementation Plan

> **For agentic workers:** REQUIRED: execute this plan in order, keep steps small, and preserve the package boundaries in `docs/architecture/`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cuekit v0 as a Bun/TypeScript monorepo with a minimal delegation protocol, SQLite-backed session/task state, an `incur`-based CLI/MCP control surface, and one end-to-end working adapter path.

**Architecture:** cuekit is implemented as four packages: `@cuekit/core` for pure protocol/schema logic, `@cuekit/store` for SQLite persistence, `@cuekit/adapters` for runtime bindings, and `@cuekit/mcp` for an `incur`-based control surface that exposes the same command definitions as both CLI commands and MCP tools. v0 is delegation-first: submit, status, result, cancel are required; steering is optional.

**Tech Stack:** Bun 1.2+, TypeScript 5.8+, Bun workspaces, Biome 2, Vitest, Zod, Bun SQLite, `incur`, MCP TypeScript SDK.

---

## File Structure

### Workspace root
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `bunfig.toml`
- Create: `.gitignore`
- Create: `README.md`

### `packages/core`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/task-status.ts`
- Create: `packages/core/src/session-status.ts`
- Create: `packages/core/src/task-spec.ts`
- Create: `packages/core/src/task-result.ts`
- Create: `packages/core/src/task-summary.ts`
- Create: `packages/core/src/job-error.ts`
- Create: `packages/core/src/adapter-capabilities.ts`
- Create: `packages/core/src/task-refs.ts`
- Create: `packages/core/src/task-lifecycle.ts`
- Create: `packages/core/src/schema/` files for Zod schemas
- Test: `packages/core/__tests__/`

### `packages/store`
- Create: `packages/store/package.json`
- Create: `packages/store/tsconfig.json`
- Create: `packages/store/src/index.ts`
- Create: `packages/store/src/db.ts`
- Create: `packages/store/src/migrate.ts`
- Create: `packages/store/src/session-store.ts`
- Create: `packages/store/src/task-store.ts`
- Create: `packages/store/src/sql/001-init.sql`
- Test: `packages/store/__tests__/`

### `packages/adapters`
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/tsconfig.json`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/adapters/src/agent-adapter.ts`
- Create: `packages/adapters/src/adapter-registry.ts`
- Create: `packages/adapters/src/pi-adapter.ts`
- Create: `packages/adapters/src/claude-code-adapter.ts`
- Create: `packages/adapters/src/opencode-adapter.ts`
- Create: `packages/adapters/src/result-normalizer.ts`
- Test: `packages/adapters/__tests__/`

### `packages/mcp`
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/cli.ts`
- Create: `packages/mcp/src/commands/submit-task.ts`
- Create: `packages/mcp/src/commands/get-task-status.ts`
- Create: `packages/mcp/src/commands/get-task-result.ts`
- Create: `packages/mcp/src/commands/cancel-task.ts`
- Create: `packages/mcp/src/commands/list-tasks.ts`
- Create: `packages/mcp/src/commands/list-adapters.ts`
- Create: `packages/mcp/src/commands/steer-task.ts`
- Create: `packages/mcp/src/command-context.ts`
- Test: `packages/mcp/__tests__/`

---

## Chunk 1: Workspace Scaffold

### Task 1: Create workspace root files

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `bunfig.toml`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Write the root `package.json`**

Include:
- workspace root name `cuekit-workspace`
- `private: true`
- `type: "module"`
- `workspaces: ["packages/*"]`
- scripts: `build`, `typecheck`, `test`, `check`, `fix`
- dev dependencies: `typescript`, `vitest`, `@biomejs/biome`, `@types/bun`

- [ ] **Step 2: Write the root `tsconfig.json`**

Use the mimicui-style strict config:
- `target: "ESNext"`
- `module: "ESNext"`
- `moduleResolution: "bundler"`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `noEmit: true`
- `resolveJsonModule: true`

- [ ] **Step 3: Write the root `biome.json`**

Use:
- tab indentation
- double quotes
- includes for `packages/*/src/**/*.ts` and `packages/*/__tests__/**/*.ts`
- `noExplicitAny: error`
- `noUnusedImports: error`

- [ ] **Step 4: Write `bunfig.toml`**

Use:
- exact install lock behavior
- test timeout 30000ms

- [ ] **Step 5: Write `.gitignore`**

Include at minimum:
- `node_modules/`
- `dist/`
- `.cuekit/`
- `*.db`
- `*.db-shm`
- `*.db-wal`

- [ ] **Step 6: Write a short root `README.md`**

Include:
- one-sentence description
- package list
- link to `docs/specs/README.md`
- link to `docs/architecture/README.md`

- [ ] **Step 7: Run formatting/lint checks for the workspace root**

Run: `bunx biome check .`
Expected: no syntax/config errors

- [ ] **Step 8: Commit scaffold**

```bash
git add package.json tsconfig.json biome.json bunfig.toml .gitignore README.md
git commit -m "feat(workspace): add cuekit monorepo scaffold"
```

---

## Chunk 2: Core Protocol Package

### Task 2: Implement core types and schemas

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/task-status.ts`
- Create: `packages/core/src/session-status.ts`
- Create: `packages/core/src/task-spec.ts`
- Create: `packages/core/src/task-result.ts`
- Create: `packages/core/src/task-summary.ts`
- Create: `packages/core/src/job-error.ts`
- Create: `packages/core/src/adapter-capabilities.ts`
- Create: `packages/core/src/task-refs.ts`
- Create: `packages/core/src/task-lifecycle.ts`
- Create: `packages/core/src/schema/*.ts`
- Test: `packages/core/__tests__/task-lifecycle.test.ts`
- Test: `packages/core/__tests__/schemas.test.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

Include:
- package name `@cuekit/core`
- `type: "module"`
- exports for `src/index.ts`
- dependency on `zod`
- scripts: `typecheck`, `test`

- [ ] **Step 2: Create the status and error types**

Implement:
- `TaskStatus`
- `SessionStatus`
- `JobError`
- `AdapterCapabilities`

Match the spec documents exactly.

- [ ] **Step 3: Create the task/session data structures**

Implement:
- `TaskSpec`
- `TaskResult`
- `TaskSummary`
- `TaskRefs` (for `result_ref`, `transcript_ref`)

- [ ] **Step 4: Create Zod schemas for all public protocol shapes**

At minimum:
- `TaskSpecSchema`
- `TaskStatusSchema`
- `SessionStatusSchema`
- `TaskResultSchema`
- `JobErrorSchema`
- `AdapterCapabilitiesSchema`

- [ ] **Step 5: Implement lifecycle helper functions**

Implement helpers such as:
- `isTerminalTaskStatus()`
- `ensureCollectable()`
- `canCancelTask()`

These should return structured errors, not throw, for invalid task states.

- [ ] **Step 6: Write failing tests for lifecycle helpers**

Cover:
- completed tasks are collectable
- running tasks are not collectable
- terminal tasks cannot be cancelled again

- [ ] **Step 7: Write failing tests for schema parsing**

Cover:
- valid `TaskSpec`
- invalid missing `objective`
- invalid `TaskStatus`
- valid `TaskResult`

- [ ] **Step 8: Implement the minimal logic to make tests pass**

Do not add future fields not in spec.

- [ ] **Step 9: Export public API from `src/index.ts`**

Re-export schema-first public API. Prefer types inferred from Zod schemas where possible instead of hand-maintaining parallel type declarations.

- [ ] **Step 10: Run package tests and typecheck**

Run:
```bash
bun run --filter '@cuekit/core' test
bun run --filter '@cuekit/core' typecheck
```
Expected: all pass

- [ ] **Step 11: Commit core package**

```bash
git add packages/core
git commit -m "feat(core): add delegation protocol types and schemas"
```

---

## Chunk 3: Store Package

### Task 3: Implement SQLite-backed minimal state model

**Files:**
- Create: `packages/store/package.json`
- Create: `packages/store/tsconfig.json`
- Create: `packages/store/src/index.ts`
- Create: `packages/store/src/db.ts`
- Create: `packages/store/src/migrate.ts`
- Create: `packages/store/src/session-store.ts`
- Create: `packages/store/src/task-store.ts`
- Create: `packages/store/src/sql/001-init.sql`
- Test: `packages/store/__tests__/session-store.test.ts`
- Test: `packages/store/__tests__/task-store.test.ts`

- [ ] **Step 1: Create `packages/store/package.json`**

Include:
- package name `@cuekit/store`
- dependency on `@cuekit/core`
- scripts for `typecheck` and `test`

- [ ] **Step 2: Write the initial SQL migration**

Create `001-init.sql` with exactly two tables:
- `sessions`
- `tasks`

Use the schema from `docs/specs/2026-04-23-cuekit-state-model.md`.

- [ ] **Step 3: Implement DB bootstrap in `db.ts`**

Responsibilities:
- locate/create `~/.cuekit/state.db`
- open SQLite connection
- ensure parent directory exists

- [ ] **Step 4: Implement migration runner in `migrate.ts`**

Responsibilities:
- apply `001-init.sql`
- make repeated startup idempotent

- [ ] **Step 5: Write failing tests for session persistence**

Cover:
- create session row
- load session by id
- list active sessions by `worktree_path`

- [ ] **Step 6: Implement `session-store.ts`**

Functions should include:
- `createSession`
- `getSessionById`
- `listSessionsByWorktree`
- `updateSessionStatus`

- [ ] **Step 7: Write failing tests for task persistence**

Cover:
- create task row
- update task status
- set `summary`, `result_ref`, `transcript_ref`
- list tasks for a session

- [ ] **Step 8: Implement `task-store.ts`**

Functions should include:
- `createTask`
- `getTaskById`
- `listTasksBySession`
- `updateTaskStatus`
- `completeTask`

- [ ] **Step 9: Reuse core schemas when decoding rows**

Do not trust raw DB rows directly.

- [ ] **Step 10: Run store tests and typecheck**

Run:
```bash
bun run --filter '@cuekit/store' test
bun run --filter '@cuekit/store' typecheck
```
Expected: all pass

- [ ] **Step 11: Commit store package**

```bash
git add packages/store
git commit -m "feat(store): add sqlite session and task persistence"
```

---

## Chunk 4: Adapters Package

### Task 4: Define adapter contract and one working adapter spike

> **v0 execution model:** all adapters ride on a shared **tmux pane backend** — each job runs in a dedicated tmux window so the orchestrator can submit/cancel/steer programmatically and the user can `tmux attach-session` to debug the live child. See `docs/specs/2026-04-23-cuekit-adapter-spec.md` Section 3.7 for the contract. Build the pane backend first; per-adapter code is only launch command + result extractor.

**Files:**
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/tsconfig.json`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/adapters/src/agent-adapter.ts`
- Create: `packages/adapters/src/adapter-registry.ts`
- Create: `packages/adapters/src/pi-adapter.ts`
- Create: `packages/adapters/src/claude-code-adapter.ts`
- Create: `packages/adapters/src/opencode-adapter.ts`
- Create: `packages/adapters/src/result-normalizer.ts`
- Test: `packages/adapters/__tests__/adapter-registry.test.ts`
- Test: `packages/adapters/__tests__/pi-adapter.test.ts`

- [ ] **Step 1: Create `packages/adapters/package.json`**

Include dependencies on:
- `@cuekit/core`
- `@cuekit/store`

- [ ] **Step 2: Define the `AgentAdapter` interface**

Match the protocol spec:
- `submit`
- `status`
- `collect`
- `cancel`
- `list`
- `steer` optional in practice, but present in interface if needed by design

- [ ] **Step 3: Implement `adapter-registry.ts`**

Responsibilities:
- register adapters by `agent_kind`
- lookup adapter
- list capabilities

- [ ] **Step 4: Write failing tests for adapter registry**

Cover:
- register one adapter
- reject duplicate `agent_kind`
- list capabilities

- [ ] **Step 5: Implement a minimal `result-normalizer.ts`**

Responsibilities:
- convert runtime-native output into `TaskResult`
- tolerate missing transcript/result refs

- [ ] **Step 5.5: Implement the shared `PaneBackend`**

Before touching a specific adapter, build the shared tmux pane backend:

- `createSession(session_id)` — lazily creates the `cuekit-{session_id}` tmux session if missing
- `spawnJob({ session_id, job_id, launchCommand, cwd })` — `tmux new-window` + `pipe-pane` to `<worktree>/.cuekit/jobs/<id>/transcript.txt`, returns `{ pane_id, attach_hint }`
- `isAlive(pane_id)` — liveness check via `tmux list-panes`
- `sendKeys(pane_id, message)` — wraps `tmux send-keys` for steering
- `killJob(session_id, job_id)` — `tmux kill-window`
- `computeAttachHint(session_id, job_id)` — returns `tmux attach-session -t cuekit-{session_id}:job-{id}`
- graceful error if `tmux` is not on `PATH` → structured `submit_failed`

- [ ] **Step 6: Pick one adapter as the first end-to-end spike**

Recommendation: start with the runtime that is easiest to launch non-interactively-yet-interactively inside a tmux pane (i.e. whichever CLI accepts an objective as an argument and stays in foreground in a TTY).

The first adapter only needs to prove:
- submit works (launches via PaneBackend)
- status can be observed (pane liveness + transcript tail)
- collect returns normalized result
- cancel is wired (PaneBackend.killJob)
- `attach_hint` is returned from `status()` while the job is non-terminal

- [ ] **Step 7: Write failing tests around that first adapter's contract**

Use test doubles or controlled subprocess fixtures as needed.

- [ ] **Step 8: Implement the first adapter minimally**

Do not solve all runtime edge cases yet.

- [ ] **Step 9: Stub the remaining two adapters with truthful capabilities**

They may return `submit_failed` or `steering_unsupported` until implemented, but their exported shape should exist.

- [ ] **Step 10: Run adapters tests and typecheck**

Run:
```bash
bun run --filter '@cuekit/adapters' test
bun run --filter '@cuekit/adapters' typecheck
```
Expected: all pass

- [ ] **Step 11: Commit adapters package**

```bash
git add packages/adapters
git commit -m "feat(adapters): add adapter contract and first runtime spike"
```

---

## Chunk 5: MCP Package

### Task 5: Expose the v0 MCP control surface

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/cli.ts`
- Create: `packages/mcp/src/commands/submit-task.ts`
- Create: `packages/mcp/src/commands/get-task-status.ts`
- Create: `packages/mcp/src/commands/get-task-result.ts`
- Create: `packages/mcp/src/commands/cancel-task.ts`
- Create: `packages/mcp/src/commands/list-tasks.ts`
- Create: `packages/mcp/src/commands/list-adapters.ts`
- Create: `packages/mcp/src/commands/steer-task.ts`
- Create: `packages/mcp/src/command-context.ts`
- Test: `packages/mcp/__tests__/tools.test.ts`

- [ ] **Step 1: Create `packages/mcp/package.json`**

Include dependencies on:
- `@cuekit/core`
- `@cuekit/store`
- `@cuekit/adapters`
- `incur`
- MCP TypeScript SDK

- [ ] **Step 2: Implement the `incur` command bootstrap**

Responsibilities:
- create the shared command tree
- attach Zod input/output schemas to each command
- wire store + adapter registry through a command context
- expose the same commands as CLI and MCP

- [ ] **Step 3: Write failing tests for `submit_task`**

Cover:
- valid request -> stable `task_id` / acceptance payload
- invalid request -> tool/input error

- [ ] **Step 4: Implement `submit-task.ts`**

Responsibilities:
- parse input with schema
- create task/session state as needed
- call adapter submit
- persist state
- return normalized acceptance payload
- define the command output schema so CLI and MCP share one contract

- [ ] **Step 5: Write failing tests for `get_task_status` and `get_task_result`**

Cover:
- task exists -> structured response
- collect on non-terminal -> structured `invalid_state` error

- [ ] **Step 6: Implement `get-task-status.ts` and `get-task-result.ts`**

Use core/store/adapters only. No runtime-specific branching in handlers.

- [ ] **Step 7: Write failing tests for `cancel_task`, `list_tasks`, and `list_adapters`**

Cover:
- cancel returns structured ack
- list returns summaries only
- list adapters returns capability list

- [ ] **Step 8: Implement the remaining required commands/tools**

- [ ] **Step 9: Add `steer_task` as optional / experimental**

If unsupported by the selected adapter, return structured `steering_unsupported`.

- [ ] **Step 10: Run control-surface package tests and typecheck**

Run:
```bash
bun run --filter '@cuekit/mcp' test
bun run --filter '@cuekit/mcp' typecheck
```
Expected: all pass

- [ ] **Step 11: Verify CLI/MCP parity manually**

Run representative flows through both surfaces and confirm they share the same validation and payload shapes.

- [ ] **Step 12: Run workspace checks**

Run:
```bash
bun run typecheck
bun run test
bun run check
```
Expected: all pass

- [ ] **Step 13: Commit MCP package**

```bash
git add packages/mcp
git commit -m "feat(mcp): add cuekit task control surface"
```

---

## Chunk 6: End-to-End Validation and Docs Touch-up

### Task 6: Validate the minimal v0 flow

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/README.md`
- Modify: `docs/architecture/README.md`
- Test: end-to-end smoke coverage in `packages/mcp/__tests__/` or `packages/adapters/__tests__/`

- [ ] **Step 1: Write a smoke test for the minimal delegation flow**

Validate:
```text
submit_task
  -> get_task_status
  -> get_task_result
```

Include cancel path if possible.

Also validate the same flow through the CLI command surface.

- [ ] **Step 2: Verify local result file refs are created where expected**

Expected pattern:
```text
<worktree>/.cuekit/tasks/<task-id>.result.json
<worktree>/.cuekit/tasks/<task-id>.transcript.md
```

- [ ] **Step 3: Update root README with actual package usage**

Include:
- how to run the CLI
- how to run the MCP server
- how state is stored
- what v0 supports

- [ ] **Step 4: Update docs indexes if paths or package names changed during implementation**

- [ ] **Step 5: Run full workspace verification one last time**

Run:
```bash
bun run typecheck
bun run test
bun run check
```
Expected: all pass

- [ ] **Step 6: Commit final MVP validation/docs pass**

```bash
git add README.md docs packages
git commit -m "chore: validate cuekit v0 delegation flow"
```

---

## Notes for Implementers

- Do not add workflow/kanban/memory platform behavior to v0.
- Do not normalize `projects` or `worktrees` into separate tables yet.
- Keep steering optional.
- Prefer one strong adapter spike over three half-working adapters.
- Preserve architecture boundaries from `docs/architecture/` even if a shortcut seems attractive.
- Treat Zod schemas as the canonical public boundary and infer types from them where practical.
- Keep `incur` confined to the control-surface package; do not leak it into core/store/adapters.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-23-cuekit-implementation-plan.md`. Ready to execute?
