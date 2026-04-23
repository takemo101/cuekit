## Summary
Implement the v0 control surface in `packages/mcp` using `incur`, with one shared command tree exposed as both CLI commands and MCP tools.

## Why
cuekit should not maintain separate CLI and MCP implementations. `incur` allows one schema-first command definition to power both surfaces and keeps the public control surface small and consistent.

## Scope
Implement the command/tool surface for:
- `submit_task`
- `get_task_status`
- `get_task_result`
- `cancel_task`
- `list_tasks`
- `list_adapters`
- `steer_task` (optional / experimental)

## Deliverables
### Source files
- `packages/mcp/src/index.ts`
- `packages/mcp/src/cli.ts`
- `packages/mcp/src/command-context.ts`
- `packages/mcp/src/commands/submit-task.ts`
- `packages/mcp/src/commands/get-task-status.ts`
- `packages/mcp/src/commands/get-task-result.ts`
- `packages/mcp/src/commands/cancel-task.ts`
- `packages/mcp/src/commands/list-tasks.ts`
- `packages/mcp/src/commands/list-adapters.ts`
- `packages/mcp/src/commands/steer-task.ts`

### Tests
- `packages/mcp/__tests__/tools.test.ts`
- additional tests as needed for CLI/MCP parity

## Detailed tasks
- [ ] Create `@cuekit/mcp` package manifest and tsconfig
- [ ] Add dependencies on `@cuekit/core`, `@cuekit/store`, `@cuekit/adapters`, and `incur`
- [ ] Define a shared command context for wiring store + registry
- [ ] Build the root `incur` CLI/command tree
- [ ] Implement `submit_task`
  - [ ] validate input with Zod
  - [ ] create session/task state as needed
  - [ ] dispatch to adapter
  - [ ] return acceptance payload with output schema
- [ ] Implement `get_task_status`
  - [ ] refresh/return normalized status
- [ ] Implement `get_task_result`
  - [ ] reject non-terminal collection with structured `invalid_state`
- [ ] Implement `cancel_task`
- [ ] Implement `list_tasks`
- [ ] Implement `list_adapters`
- [ ] Implement `steer_task` as optional/experimental
  - [ ] return structured `steering_unsupported` where appropriate
- [ ] Ensure CLI and MCP come from the same command definitions
- [ ] Add tests for malformed input, valid responses, and invalid-state handling
- [ ] Add parity checks so CLI and MCP share the same schema/semantics
- [ ] Run validation commands
  - [ ] `bun run --filter '@cuekit/mcp' test`
  - [ ] `bun run --filter '@cuekit/mcp' typecheck`

## Acceptance criteria
- One `incur` command tree exists as the single source of truth
- Required commands/tools are callable
- CLI and MCP surfaces share Zod-defined input/output schemas
- Protocol-level failures return structured payloads rather than opaque handler-specific errors
- Runtime-specific branching stays below the control surface

## Out of scope
- Orchestration/planner behavior
- HTTP API
- Batch DAG scheduling
- Long-lived event subscriptions beyond what is needed for v0

## References
- `docs/specs/2026-04-23-cuekit-mcp-api-spec.md`
- `docs/specs/2026-04-23-cuekit-design.md`
- `docs/architecture/overview.md`
- `docs/plans/2026-04-23-cuekit-implementation-plan.md`
