# 002: Grouped MCP Surface (2026-05-04)

## Context

cuekit's prototype MCP surface grew to more than twenty flat tools. That made tool selection noisy for AI callers, especially where task/team variants had parallel names (`list_tasks` vs `list_teams`, `wait_tasks` vs `wait_team`, cleanup/delete variants, etc.).

`show_mcp_config` was also exposed as an MCP tool even though it is only useful before MCP is connected.

## Decision

Expose a smaller grouped AI-facing MCP tool surface:

- `submit_task`
- `submit_team_tasks`
- `create_team`
- `get_status` (`kind: task | team`)
- `get_task_result`
- `wait` (`kind: tasks | team`)
- `cancel_tasks`
- `list` (`kind: tasks | teams | events | adapters | agent_profiles`)
- `report_task_event`
- `steer_task`
- `steer_team`
- `cleanup` (`kind: tasks | team`)
- `delete` (`kind: tasks | sessions`)

Keep grouped human CLI commands unchanged. Keep `cuekit mcp config` as a human CLI helper, but do not expose `show_mcp_config` through MCP.

Backward compatibility is intentionally not preserved while cuekit is in prototype stage.

## Consequences

- AI callers see fewer tools and choose by `kind` inside grouped tools.
- AI callers should use short bounded `wait` calls and poll again instead of issuing one long MCP request.
- On wait timeout, AI callers should inspect `get_status`; if `attention_hint` is present, they can use `steer_task` to ask one child to report progress or finish, or `steer_team` to broadcast one instruction to all currently non-terminal tasks in a team, then inspect `list({ kind: "events", task_id })`.
- CLI setup remains available through `cuekit mcp config`.
- Historical docs/specs may mention the older flat MCP names, but current README/architecture/tests should describe the grouped surface.
