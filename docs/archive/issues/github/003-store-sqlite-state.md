## Summary
Implement the minimal SQLite-backed state store in `packages/store` using the agreed v0 schema and Zod-validated row decoding.

## Why
cuekit needs durable session/task tracking independent of any specific runtime. This package owns the global state index and should remain small and explicit.

## Scope
Implement:
- SQLite bootstrap
- migrations
- `sessions` table
- `tasks` table
- store APIs for create/read/update/list operations

## Deliverables
### Source files
- `packages/store/src/index.ts`
- `packages/store/src/db.ts`
- `packages/store/src/migrate.ts`
- `packages/store/src/session-store.ts`
- `packages/store/src/task-store.ts`
- `packages/store/src/sql/001-init.sql`

### Tests
- `packages/store/__tests__/session-store.test.ts`
- `packages/store/__tests__/task-store.test.ts`

## Detailed tasks
- [ ] Create `@cuekit/store` package manifest and tsconfig
- [ ] Add dependency on `@cuekit/core`
- [ ] Write initial SQL migration
  - [ ] Create `sessions` table
  - [ ] Create `tasks` table
  - [ ] Keep schema minimal; do not add extra tables
- [ ] Implement database bootstrap
  - [ ] Create `~/.cuekit/` if missing
  - [ ] Open/create `~/.cuekit/state.db`
- [ ] Implement idempotent migration runner
- [ ] Implement session store API
  - [ ] `createSession`
  - [ ] `getSessionById`
  - [ ] `listSessionsByWorktree`
  - [ ] `updateSessionStatus`
- [ ] Implement task store API
  - [ ] `createTask`
  - [ ] `getTaskById`
  - [ ] `listTasksBySession`
  - [ ] `updateTaskStatus`
  - [ ] `completeTask`
- [ ] Decode public-facing rows through core Zod schemas before returning them
- [ ] Add tests for session persistence and task persistence
- [ ] Run validation commands
  - [ ] `bun run --filter '@cuekit/store' test`
  - [ ] `bun run --filter '@cuekit/store' typecheck`

## Acceptance criteria
- `sessions` and `tasks` are the only v0 tables
- Session and task rows can be created, loaded, listed, and updated
- `result_ref` and `transcript_ref` can be persisted
- Public return values are schema-validated
- Tests cover the minimal happy paths and key update flows

## Out of scope
- Artifact normalization table
- Event stream storage
- Project/worktree normalization tables
- Runtime adapter logic

## References
- `docs/specs/2026-04-23-cuekit-state-model.md`
- `docs/architecture/overview.md`
- `docs/plans/2026-04-23-cuekit-implementation-plan.md`
