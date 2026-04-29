## Summary
Implement the v0 control surface in `packages/mcp` using `incur`, with shared operation handlers and schemas projected as grouped CLI commands and flat MCP tools.

## Why
cuekit should not maintain separate CLI and MCP business logic. `incur` allows schema-first operation definitions to power both surfaces while letting each surface use caller-friendly public names.

## Scope
Implement the MCP command/tool surface for:
- `submit_task`
- `get_task_status`
- `get_task_result`
- `cancel_task`
- `list_tasks`
- `list_adapters`
- `steer_task` (optional / experimental)
- `delete_task`
- `delete_session`
- `show_mcp_config`

Expose the same operations through grouped CLI commands without backwards-compatible flat CLI aliases:

- `cuekit task submit`
- `cuekit task status`
- `cuekit task result`
- `cuekit task cancel`
- `cuekit task list`
- `cuekit task steer` (optional / experimental)
- `cuekit task delete`
- `cuekit adapter list`
- `cuekit session delete`
- `cuekit mcp config`

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
- `packages/mcp/src/commands/delete-task.ts`
- `packages/mcp/src/commands/delete-session.ts`
- `packages/mcp/src/commands/show-mcp-config.ts`

### Tests
- `packages/mcp/__tests__/tools.test.ts`
- additional tests as needed for CLI/MCP parity

## Detailed tasks
- [ ] Create `@cuekit/mcp` package manifest and tsconfig
- [ ] Add dependencies on `@cuekit/core`, `@cuekit/store`, `@cuekit/adapters`, and `incur`
- [ ] Define a shared command context for wiring store + registry
- [ ] Build the shared operation registry and `incur` CLI/MCP projections
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
- [ ] Implement `delete_task`, `delete_session`, and `show_mcp_config`
- [ ] Ensure CLI and MCP come from the same handlers and Zod schemas
- [ ] Add tests for malformed input, valid responses, and invalid-state handling
- [ ] Add parity checks so CLI and MCP share the same schema/semantics
- [ ] Run validation commands
  - [ ] `bun run --filter '@cuekit/mcp' test`
  - [ ] `bun run --filter '@cuekit/mcp' typecheck`

## Acceptance criteria
- One schema-backed operation registry exists as the single source of truth
- Required commands/tools are callable
- CLI and MCP surfaces share Zod-defined input/output schemas
- CLI uses grouped resource commands; MCP keeps flat snake_case tool names
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
