## Summary
Implement the pure protocol/domain layer in `packages/core` with schema-first definitions and Zod-backed type safety.

## Why
This package is the canonical contract for the whole system. Store, adapters, and the control surface must all depend on the same task/session/result/error semantics.

## Scope
Implement the public protocol shapes, lifecycle helpers, and schemas for cuekit v0.

## Deliverables
### Core source files
- `packages/core/src/index.ts`
- `packages/core/src/task-status.ts`
- `packages/core/src/session-status.ts`
- `packages/core/src/task-spec.ts`
- `packages/core/src/task-result.ts`
- `packages/core/src/task-summary.ts`
- `packages/core/src/job-error.ts`
- `packages/core/src/task-refs.ts`
- `packages/core/src/adapter-capabilities.ts`
- `packages/core/src/task-lifecycle.ts`
- `packages/core/src/schema/*.ts`

### Tests
- `packages/core/__tests__/task-lifecycle.test.ts`
- `packages/core/__tests__/schemas.test.ts`

## Detailed tasks
- [ ] Create `@cuekit/core` package manifest and tsconfig
- [ ] Define status enums/unions
  - [ ] `TaskStatus`
  - [ ] `SessionStatus`
- [ ] Define protocol data shapes
  - [ ] `TaskSpec`
  - [ ] `TaskResult`
  - [ ] `TaskSummary`
  - [ ] `TaskRefs`
  - [ ] `AdapterCapabilities`
  - [ ] `JobError`
- [ ] Implement lifecycle helpers
  - [ ] `isTerminalTaskStatus()`
  - [ ] `ensureCollectable()`
  - [ ] `canCancelTask()`
- [ ] Make invalid state/reportable conditions return structured results rather than throwing
- [ ] Define Zod schemas for all public boundary shapes
- [ ] Infer exported TypeScript types from Zod schemas where practical
- [ ] Add tests for valid and invalid parsing cases
- [ ] Add tests for lifecycle semantics
- [ ] Export only stable public API from `src/index.ts`
- [ ] Run validation commands
  - [ ] `bun run --filter '@cuekit/core' test`
  - [ ] `bun run --filter '@cuekit/core' typecheck`

## Acceptance criteria
- `@cuekit/core` has no runtime-specific dependencies
- Public protocol shapes match the current specs
- Recoverable conditions are represented as structured errors/results
- Zod schemas cover every public boundary shape
- Tests prove schema parsing and lifecycle behavior

## Out of scope
- SQLite persistence
- Adapter-specific logic
- `incur` usage
- MCP/CLI command registration

## References
- `docs/specs/2026-04-23-cuekit-protocol-spec.md`
- `docs/specs/2026-04-23-cuekit-state-model.md`
- `docs/architecture/overview.md`
- `docs/architecture/error-handling.md`
