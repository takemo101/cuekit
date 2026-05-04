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
- `cleanup` (`kind: tasks | team`)
- `delete` (`kind: tasks | sessions`)

Keep grouped human CLI commands unchanged. Keep `cuekit mcp config` as a human CLI helper, but do not expose `show_mcp_config` through MCP.

Backward compatibility is intentionally not preserved while cuekit is in prototype stage.

## Consequences

- AI callers see fewer tools and choose by `kind` inside grouped tools.
- AI callers should use short bounded `wait` calls and poll again instead of issuing one long MCP request.
- CLI setup remains available through `cuekit mcp config`.
- Historical docs/specs may mention the older flat MCP names, but current README/architecture/tests should describe the grouped surface.
