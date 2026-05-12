# cuekit Hooks Design

## Status

Proposed design.

## Context

`isuner` has a flexible hook system that lets users run shell commands on workflow events. cuekit should have a similar mechanism so users can receive notifications (macOS Notification Center, Slack, Discord, sound, etc.) when tasks complete, fail, or need input.

## Goals

- Run user-defined shell commands asynchronously when task/team lifecycle events occur.
- Provide event metadata via environment variables.
- Keep configuration in `.cuekit.yaml`.
- Never block the main workflow on hook execution.
- Never fail the main workflow when a hook fails.

## Non-goals

- Do not support synchronous hooks that can block or stop workflows.
- Do not pass JSON via stdin or temporary files.
- Do not support remote webhooks directly (users can use `curl` in their shell command).

## Configuration

### `.cuekit.yaml` shape

```yaml
hooks:
  on_task_start:
    command: "osascript -e 'display notification \"Started: $CUEKIT_OBJECTIVE\"'"
    timeout: 10

  on_task_complete:
    command: "osascript -e 'display notification \"Done: $CUEKIT_OBJECTIVE\"'"
    timeout: 10

  on_task_fail:
    command: "osascript -e 'display notification \"Failed: $CUEKIT_OBJECTIVE\"'"
    timeout: 10

  on_task_cancel:
    command: "echo '$CUEKIT_TASK_ID cancelled' >> ~/cuekit.log"

  on_task_block:
    command: "osascript -e 'display notification \"Blocked: $CUEKIT_OBJECTIVE\"'"

  on_team_start:
    command: "osascript -e 'display notification \"Team $CUEKIT_TEAM_ID started\"'"

  on_team_complete:
    command: "osascript -e 'display notification \"Team $CUEKIT_TEAM_ID done\"'"
```

### Schema

```typescript
interface HookDefinition {
  command: string;
  timeout?: number; // seconds, default 30
}

interface HooksConfig {
  [event: string]: HookDefinition | HookDefinition[] | undefined;
  on_task_start?: HookDefinition | HookDefinition[];
  on_task_complete?: HookDefinition | HookDefinition[];
  on_task_fail?: HookDefinition | HookDefinition[];
  on_task_cancel?: HookDefinition | HookDefinition[];
  on_task_timeout?: HookDefinition | HookDefinition[];
  on_task_block?: HookDefinition | HookDefinition[];
  on_team_start?: HookDefinition | HookDefinition[];
  on_team_complete?: HookDefinition | HookDefinition[];
}
```

- `command`: shell command executed via `/bin/sh -c`.
- `timeout`: maximum seconds to wait before killing the hook process. Default 30.

### Environment variables passed to hooks

| Variable | Description |
|----------|-------------|
| `CUEKIT_EVENT` | Event name, e.g. `on_task_complete` |
| `CUEKIT_TASK_ID` | Task ID |
| `CUEKIT_TEAM_ID` | Team ID (if task belongs to a team) |
| `CUEKIT_STATUS` | Task status: `running`, `completed`, `failed`, `cancelled`, `timed_out`, `blocked` |
| `CUEKIT_AGENT_KIND` | Agent kind, e.g. `claude-code`, `pi` |
| `CUEKIT_AGENT_MODEL` | Model identifier (if known) |
| `CUEKIT_OBJECTIVE` | Task objective (truncated to 500 chars) |
| `CUEKIT_STRATEGY` | Team strategy name (if applicable) |
| `CUEKIT_POSITION` | Team position, e.g. `coordinator`, `worker` |
| `CUEKIT_PROJECT_ID` | Project ID from `.cuekit.yaml` |
| `CUEKIT_SESSION_ID` | Session ID |
| `CUEKIT_DURATION_MS` | Task duration in milliseconds |

## Execution model

### Fire-and-forget

Hooks are executed **asynchronously** after the main operation succeeds. The caller does not `await` the hook.

```typescript
// Pseudocode
function fireHook(event: string, env: Record<string, string>): void {
  const definition = hooksConfig?.[event];
  if (!definition) return;

  // Run without awaiting — fire and forget
  Bun.spawn(["/bin/sh", "-c", definition.command], {
    env: { ...process.env, ...env },
    timeout: (definition.timeout ?? 30) * 1000,
    stdout: "ignore",
    stderr: "ignore",
    onExit: (_proc, exitCode, _signalCode, error) => {
      if (exitCode !== 0 || error) {
        logger.warn("hook failed", { event, exitCode, reason: error?.message });
      }
    },
  });
}
```

### Error handling

- Hook exit code ≠ 0: log a warning, do nothing else.
- Hook times out: OS kills the process, log a warning.
- Hook command not found: log a warning.
- **Never throw, never reject, never affect the main workflow.**

## Integration points

### Task lifecycle hooks

Fired from `pane-adapter.ts` inside `onTerminal` callback or equivalent terminal-status transitions:

| Event | When |
|-------|------|
| `on_task_start` | After a task is submitted, pane spawned, and status becomes `running` |
| `on_task_complete` | After task status becomes `completed` |
| `on_task_fail` | After task status becomes `failed` |
| `on_task_cancel` | After `cancel` successfully kills pane and updates DB |
| `on_task_timeout` | After task status becomes `timed_out` |
| `on_task_block` | After child self-report sets status to `blocked` |

### Team lifecycle hooks

Fired from team lifecycle command paths (`start_team`, `submit_team_tasks`, direct `submit_task` with `team_id`, `wait_team`, `get_team_result`, `cleanup_team`, and terminal team member self-reports):

| Event | When |
|-------|------|
| `on_team_start` | Once, after the first task is accepted for a team, regardless of submit path or position |
| `on_team_complete` | Once, after all non-empty team tasks reach a terminal status |

## Implementation plan

1. **Core types** (`@cuekit/core`): Add `HookDefinition`, `HooksConfig` interfaces.
2. **Project config** (`@cuekit/project-config`): Add `hooks` field to `CuekitProjectConfigSchema`.
3. **Hook executor** (`@cuekit/adapters` or new `@cuekit/hooks`): Create `HookDispatcher` class.
4. **Adapter wiring**: Pass `hooksConfig` through `buildAdapterRegistry` → adapter factories → `createPaneAdapter`. Fire hooks inside `onTerminal`.
5. **MCP commands**: Fire `on_team_start` from the first accepted team task; fire `on_team_complete` from cleanup/result/wait/self-report paths when the non-empty team is fully terminal.

## Open questions

- Should we add `on_steering_received`? Probably not for v0.
