# Quickstart

Get a child coding agent running under cuekit in five minutes. This page assumes you already have **[Bun](https://bun.sh) ≥ 1.2** and a terminal multiplexer (**tmux** by default; **zellij** or **herdr** also supported).

## 1. Install

```sh
npm install -g cuekit@latest
cuekit doctor
```

`cuekit doctor` verifies that Bun, your multiplexer, and at least one adapter (claude-code, opencode, jcode, gemini, pi) are on `PATH`. If something is missing, fix it before continuing.

See the full [Install guide](/install) for GitHub-source installs and upgrade paths.

## 2. Initialize the project

In the repo where you want to delegate work:

```sh
cd /path/to/your/repo
cuekit init
```

This writes a safe `.cuekit.yaml` with prompt-safe adapter defaults and adds `.cuekit/tasks/` to your `.gitignore`. Inspect the file before committing.

::: tip
To customize submit defaults, strategies, hooks, or the multiplexer backend, see the [Project Config guide](/guides/project-config).
:::

## 3. Register cuekit with your MCP client

For supported agents, one command writes (or delegates to) the right config:

```sh
cuekit mcp add --agent claude-code   # also: cursor, pi, jcode
```

For everything else, print the stanza and paste it into the client's config file yourself:

```sh
cuekit mcp config
```

After updating the client config, **restart the client**. Full client paths and overrides → [MCP Tools](/api/mcp-tools#registering-cuekit-with-your-mcp-client).

## 4. Submit a child task

From the CLI:

```sh
cuekit task submit \
  --objective "add retry logic to src/api/client.ts" \
  --agent_kind claude-code \
  --model sonnet \
  --cwd /path/to/your/repo
```

Output:

```json
{
  "task_id": "t_abc123",
  "attach_hint": "tmux attach-session -t cuekit-task-t_abc123"
}
```

The child runs in a dedicated multiplexer pane. You can attach with the printed command, or skip ahead to the TUI.

## 5. Watch and steer

In another terminal, open the TUI cockpit:

```sh
cuekit tui
```

Keybindings:

| Key | Action |
|---|---|
| ↑/↓ or j/k | select task |
| a | attach to task pane (one-way; exits TUI) |
| t | switch tasks/teams views |
| s | steer selected task |
| c | cancel selected task |
| r | refresh |
| q / Esc | quit |

Steer without attaching:

```sh
cuekit task steer --task_id t_abc123 --message "also cover exponential backoff"
```

## 6. Collect the result

When the child reports completion, fetch the normalized result:

```sh
cuekit task result --task_id t_abc123
```

cuekit reads from durable `task_events` (the source of truth) rather than the transcript tail, so this stays reliable even if the pane has scrolled past the final summary.

## What just happened

- `cuekit task submit` spawned a child claude-code in a `cuekit-task-t_abc123` multiplexer session.
- The child's progress and result events were written to `~/.cuekit/state.db` and `<repo>/.cuekit/tasks/t_abc123/`.
- You stayed in control: cuekit did not auto-schedule, auto-steer, or auto-cancel anything.

## Next steps

- **Use roles to keep submits short** → [Agent Profiles](/guides/agent-profiles)
- **Coordinate multiple children with a strategy** → [Team Strategies](/guides/team-strategies)
- **Call cuekit from a parent AI agent (MCP)** → [MCP Tools](/api/mcp-tools)
- **Pin or pre-release installs / Homebrew / source builds** → [Install](/install)
