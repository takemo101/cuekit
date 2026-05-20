# MCP Tools

cuekit exposes its full protocol surface to MCP clients via a small set of **grouped tools** plus stable flat aliases for the most common operations. The grouped form is preferred for AI callers — fewer tool names to remember, dispatched by a `kind` field.

Start the stdio server:

```sh
cuekit --mcp
```

## Registering cuekit with your MCP client

cuekit ships two helpers depending on whether your client has its own MCP-install command:

| Helper | When to use |
|---|---|
| `cuekit mcp add` | **Easy path.** Writes the config directly for clients cuekit knows about (`pi`, `jcode`) or delegates to the target agent's native `<agent> mcp add` command (`claude-code`, `cursor`, etc.). |
| `cuekit mcp config` | **Manual path.** Prints the JSON stanza you paste into a client's config file yourself. |

### `cuekit mcp add` (recommended)

```sh
cuekit mcp add --agent claude-code        # registers via `claude mcp add`
cuekit mcp add --agent cursor             # delegates to cursor's own MCP-install command
cuekit mcp add --agent pi                 # writes Pi's MCP config directly
cuekit mcp add --agent jcode              # writes jcode's MCP config directly
cuekit mcp add --agent pi --no-global     # project-local instead of user-global
```

Useful flags:

| Flag | Effect |
|---|---|
| `--agent <name>` | Target agent: `claude-code`, `cursor`, `pi`, `jcode`, ... |
| `-c, --command <string>` | Override the command agents run (e.g. `"pnpm my-cli --mcp"`). Useful for workspace-linked checkouts. |
| `--no-global` | Install to project scope instead of the user-global config. |

For native agents (`pi`, `jcode`) cuekit writes the config file itself. For agents with their own MCP-install CLI (`claude mcp add`, `cursor` etc.), cuekit delegates to that command so you stay on the agent's supported install path.

### `cuekit mcp config` (manual)

Generate a paste-ready stanza:

```sh
cuekit mcp config
```

Output (shape used by Claude Desktop, Claude Code, Cursor, and other clients that follow the `mcpServers` convention):

```jsonc
{
  "mcpServers": {
    "cuekit": {
      "command": "cuekit",
      "args": ["--mcp"]
    }
  }
}
```

Merge that object into your client's config file:

| Client | Config file |
|---|---|
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | `~/.claude.json` (global) or `<repo>/.mcp.json` (project) |
| **Cursor** | `~/.cursor/mcp.json` (global) or `<repo>/.cursor/mcp.json` (project) |
| **Codex CLI** | `~/.codex/config.json` |

After editing the config, **restart the client** so it picks up the new server.

### Side-by-side installs

Both helpers accept overrides for non-default install layouts:

```sh
cuekit mcp add    --agent claude-code -c "/Users/me/cuekit/bin/cuekit.js --mcp"
cuekit mcp config --name cuekit-dev --bin /Users/me/cuekit/bin/cuekit.js
```

Useful when running a workspace-linked checkout alongside an `npm install -g`'d copy.

### Verify the connection

After restarting the client, ask it to list the available MCP tools. You should see grouped tools like `list`, `steer`, `delete`, `submit_task`, `wait`, `report_task_event`, plus the flat aliases.

::: tip
`cuekit mcp config` and `cuekit mcp add` are **CLI-only**. There is no MCP tool that re-configures other MCP clients — that would be a footgun. See [ADR 002](https://github.com/takemo101/cuekit/blob/main/docs/decisions/002-grouped-mcp-surface.md).
:::

## Tool catalog

### Submitting work

| Tool | Purpose |
|---|---|
| `submit_task` | Spawn a single child task. Returns `task_id` and `attach_hint`. |
| `create_team` | Create an empty team (for coordinator-led patterns). |
| `submit_team_tasks` | Submit one or more child tasks under an existing team. |
| `start_team_strategy` | Start a team from a project-local Team Strategy. Renders the strategy prompt for the coordinator. |

### Reading state

| Tool | Purpose |
|---|---|
| `list({ kind })` | Grouped list. `kind ∈ {"tasks","teams","events","adapters","agent_profiles","strategies"}`. Pass `cwd` for project-local strategy discovery. |
| `get_status` | Status for a single task (lightweight). |
| `get_task_snapshot` | **Recommended pre-intervention read.** Recent events, latest handoffs, transcript tail in one call. |
| `get_team_snapshot` | Equivalent for teams. |
| `get_task_result` | Normalized result; event-first, falls back to transcript only when needed. |
| `get_team_result` | Team result derived from `task_events`, not transcript scraping. |
| `report` | Children report progress and completion via `report_task_event`. The single source of truth for task progress. → [ADR 001](https://github.com/takemo101/cuekit/blob/main/docs/decisions/001-child-reporting-surface.md) |
| `report_task_event` | Flat alias of the same operation. |

### Waiting

| Tool | Purpose |
|---|---|
| `wait` | Parent-side bounded polling. `kind ∈ {"tasks","team"}`. Prefer short `timeout_ms` and re-poll over one long request. |

```jsonc
// example payload
{
  "kind": "tasks",
  "task_ids": ["t_..."],
  "timeout_ms": 30000,
  "poll_interval_ms": 5000
}
```

A wait timeout only stops waiting — child work keeps running. For coordinator-led teams that submit workers after the wait begins, pass `follow_new_tasks: true` to keep watching new members.

### Steering

| Tool | Purpose |
|---|---|
| `steer({ kind, ... })` | **Preferred.** `kind ∈ {"task","team","team_position","team_tasks"}`. Optionally `event_type: "handoff"` records a typed handoff artifact after a successful steer. |
| `steer_task` / `steer_team` | Compatibility aliases. |

`steer` kind reference:

| `kind` | Required extra fields | Effect |
|---|---|---|
| `task` | `task_id`, `message` | Steer one task. |
| `team` | `team_id`, `message` | Steer the entire team (typically the coordinator and broadcastable members). |
| `team_position` | `team_id`, `position`, `message` | Steer all team members at a position (`coordinator` / `worker` / `reviewer` / `finisher` / `observer`). |
| `team_tasks` | `team_id`, `task_ids`, `message` | Steer an explicit subset of team task ids. |

::: warning
Typed handoffs are only persisted **after** the adapter steer succeeds. If steer fails, no `handoff` artifact or `task_events` row is written. `actor` / `source` are intentionally not supported — write provenance into the handoff body.
:::

### Cleanup

| Tool | Purpose |
|---|---|
| `cancel_tasks` | Cancel one or more running tasks. |
| `cleanup` | Cleanup grouped operation. |
| `delete({ kind, ... })` | `kind ∈ {"tasks","sessions","team"}`. Deletes terminal records, not running work — cuekit will not nuke active child tasks. |

`delete` kind reference:

| `kind` | Required extra fields | Effect |
|---|---|---|
| `tasks` | `task_ids` | Delete one or more terminal task records and their artifacts. |
| `sessions` | `session_ids` | Delete session records (along with any orphaned task pointers). |
| `team` | `team_id` | Delete an empty team. Refuses if the team still has non-terminal tasks. |

### Convenience

| Tool | Purpose |
|---|---|
| `steer_task` / `steer_team` | Flat aliases for `steer({ kind: "task" \| "team" })`. |

## Why grouped + flat aliases?

ADR 002 makes this explicit: grouped tools (`list`, `steer`, `delete`) are the AI-facing surface because they reduce tool-name lookup and keep dispatch parametric. Flat aliases (`steer_task`, `steer_team`, `report_task_event`) remain because some prompts and integrations are easier to write with stable single-purpose names. New tools should be added to the grouped surface first.

## Patterns

### Coordinator-led teams

1. `create_team` → get `team_id`.
2. `submit_team_tasks` with the first workers.
3. `wait({ kind: "team", team_id, follow_new_tasks: true, timeout_ms: 30000 })` loops.
4. Inspect with `get_team_snapshot` before steering.
5. `steer({ kind: "team", ... })` or per-task steering.
6. `get_team_result` for the final event-derived summary.

### Pre-intervention snapshot

Always call `get_task_snapshot` (or `get_team_snapshot`) **before** sending a steer or HANDOFF. It returns recent events, the latest handoffs, and the transcript tail in one call — much safer than blind steering. → [MCP API spec §10.6](https://github.com/takemo101/cuekit/blob/main/docs/specs/2026-04-23-cuekit-mcp-api-spec.md)

### Batch (one-shot) tasks

Pass `adapter_options: { "mode": "batch" }` on `submit_task`. The pane still exists and is attachable, but `supports_steering: false`. `steer_task` will reject batch tasks with `steering_unsupported`.

## Strict ID handling

Task and team IDs are opaque strings. cuekit never assumes ordering or hash structure. Always read them from the response, never construct them in the client.

## See also

- [Quickstart](/quickstart) — end-to-end example.
- [Team Strategies](/guides/team-strategies) — how `start_team_strategy` composes with `.cuekit.yaml`.
- [Agent Profiles](/guides/agent-profiles) — `role` resolution for `submit_task`.
